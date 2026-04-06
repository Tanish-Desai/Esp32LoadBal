#include<Arduino.h>
#include <WiFi.h>
#include<WiFiManager.h>
#include<Preferences.h>

#include <LoadBalancerStrategy.h>
#include <RoundRobin.h>
#include <QLearning.h>
#include <EmaResponseTime.h>

// The "Real" Server (Your Laptop)
const int MAX_BACKENDS = 5;
int num_backends = 1;
int backend_ports[MAX_BACKENDS] = {8080, 8081, 8082, 8083, 8084};

// The ESP32 Load Balancer Port
const int listen_port = 80;

// Define a buffer size
const int buffSize = 1024;
uint8_t buffer[buffSize];

// temporary server_ip string for portal purposes
String server_ip;
Preferences preferences;
String set_server_ip();

WiFiServer publicServer(listen_port);

// --- GLOBAL CLIENTS TO KEEP CONNECTION ALIVE ---
// ESP32 supports max 16 sockets. 1 for listener, 2 per client (frontend+backend). (16-1)/2 = 7 max clients.
const int MAX_CLIENTS = 7;

struct ProxySession {
    WiFiClient client;
    WiFiClient backend;
    int backend_idx;
    unsigned long start_time;
    bool active;
};

ProxySession sessions[MAX_CLIENTS];
// -----------------------------------------------

LoadBalancerStrategy* lb_strategy;

// Forward Declaring funcs
void talk(WiFiClient& c1, WiFiClient& c2);
int get_num_backends();
int get_strategy_choice();

void setup() {
    Serial.begin(115200);

    // Initialize Storage
    preferences.begin("config", false);
    server_ip = preferences.getString("server_ip", "192.168.1.100");

    WiFiManager wm;

    // adds server ip param to portal
    WiFiManagerParameter custom_server_ip("server", "Laptop IP", server_ip.c_str(), 16);
    wm.addParameter(&custom_server_ip);

    wm.setSaveConfigCallback([&]() {
        server_ip = custom_server_ip.getValue();
        preferences.putString("server_ip", server_ip);
        Serial.println("Saved new server IP: " + server_ip);
    });

    bool success = wm.autoConnect("ESP32 Web Portal");
    if(!success){
        Serial.println("Failed to connect or hit timeout");
    }else{
        Serial.println("\n\nConnected...");
        Serial.print("Local IP Address: ");
        Serial.println(WiFi.localIP());

        // (We also update it here just in case WiFiManager returns without rebooting)
        server_ip = custom_server_ip.getValue();
        preferences.putString("server_ip", server_ip);
    }

    publicServer.begin();
    
    Serial.println("\nCurrent saved Laptop IP: " + server_ip);
    Serial.println("Enter new Laptop IP (or just press enter to keep current):");
    String new_ip = set_server_ip();
    if(new_ip.length() > 0) {
        server_ip = new_ip;
        preferences.putString("server_ip", server_ip);
        Serial.println("Saved new server IP: " + server_ip);
    } else {
        Serial.println("Continuing with server IP: " + server_ip);
    }
    
    num_backends = get_num_backends();
    Serial.printf("Configured for %d backends.\n", num_backends);

    int strategy_choice = get_strategy_choice();
    if (strategy_choice == 1) {
        lb_strategy = new RoundRobin(num_backends);
        Serial.println("Selected Strategy: Round Robin");
    } else if (strategy_choice == 2) {
        lb_strategy = new QLearning(num_backends, MAX_CLIENTS);
        Serial.println("Selected Strategy: Q-Learning");
    } else {
        lb_strategy = new EmaResponseTime(num_backends);
        Serial.println("Selected Strategy: EMA Response Time");
    }
}

int get_active_clients() {
    int active = 0;
    for (int i = 0; i < MAX_CLIENTS; i++) {
        if (sessions[i].active) active++;
    }
    return active;
}

void loop() {
    // 1. Check for ANY new incoming client
    WiFiClient newClient = publicServer.available();

    if (newClient) {
        Serial.println("New connection request received...");
        bool assigned = false;
        
        for (int i = 0; i < MAX_CLIENTS; i++) {
            if (!sessions[i].active || !sessions[i].client.connected()) {
                Serial.printf("Assigning to Slot %d\n", i + 1);
                
                // Initialize session
                sessions[i].client = newClient;
                sessions[i].active = true;
                sessions[i].start_time = millis();
                
                // Connect Backend
                bool backend_connected = false;
                int current_state = get_active_clients() - 1; // Since we just set this session active, subtract 1 for the state *before* assigning
                for (int j = 0; j < num_backends; j++) {
                    int port_idx = lb_strategy->getNextBackend(current_state);
                    if (sessions[i].backend.connect(server_ip.c_str(), backend_ports[port_idx])) {
                        Serial.printf("Backend Connected (Port %d)\n", backend_ports[port_idx]);
                        sessions[i].backend_idx = port_idx;
                        backend_connected = true;
                        break;
                    } else {
                        Serial.printf("Backend Failed on Port %d. Trying next...\n", backend_ports[port_idx]);
                    }
                }

                if (!backend_connected) {
                    Serial.println("All backends failed. Cannot forward traffic.");
                    sessions[i].client.print("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\nAll backends are offline.");
                    sessions[i].client.stop();
                    sessions[i].active = false;
                }
                
                assigned = true;
                break;
            }
        }
        
        if (!assigned) {
            Serial.println("Server Full! Rejecting client.");
            newClient.print("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\nServer is at maximum capacity (7 clients).");
            newClient.stop();
        }
    }

    // 2. Handle Data Traffic for all slots
    for (int i = 0; i < MAX_CLIENTS; i++) {
        if (sessions[i].active) {
            if (sessions[i].client && sessions[i].client.connected() && sessions[i].backend && sessions[i].backend.connected()) {
                talk(sessions[i].client, sessions[i].backend);
                talk(sessions[i].backend, sessions[i].client);
            } else {
                // Connection ended or dropped
                unsigned long duration = millis() - sessions[i].start_time;
                float reward;
                
                // If duration is extremely high (e.g. >= 2000, which usually means client timeout)
                if (duration >= 2000) {
                    reward = -50.0;
                } else {
                    reward = 1000.0 / (duration + 1.0);
                }
                
                int current_state = get_active_clients();
                int next_state = current_state - 1;

                lb_strategy->provideFeedback(sessions[i].backend_idx, current_state, next_state, reward);

                Serial.printf("Session [Slot %d] ended. Backend: Port %d. Duration: %lu ms. Reward: %.2f\n", 
                              i + 1, backend_ports[sessions[i].backend_idx], duration, reward);
                
                if (sessions[i].client) sessions[i].client.stop();
                if (sessions[i].backend) sessions[i].backend.stop();
                sessions[i].active = false;
            }
        }
    }
}

void talk(WiFiClient& c1, WiFiClient& c2){
    // assuming both clients are connected
    // esp32 routes data from c1 to c2
    int len = c1.available();
    if(len > 0){
        if(len > buffSize) len = buffSize;

        c1.read(buffer, len);
        c2.write(buffer, len);
        Serial.write(buffer, len);
        for(int i=0; i<len - 2; i++){
            if(buffer[i] == 'E' && buffer[i+1] == 'N' && buffer[i+2] == 'D'){
                Serial.println("[CONTROL] END received. Terminating...");
                c1.stop();
            }
        }
    }
}

String set_server_ip(){
    while(Serial.available()) Serial.read(); // clear Serial buffer

    String input = "";
    while(true){
        if(Serial.available()){
            char c = Serial.read();
            if(c == '\n' || c == '\r') {
                break;
            }
            input += c;
        }
        delay(10); // to prevent watchdog timeout errors
    }
    input.trim();
    return input;
}

int get_num_backends(){
    Serial.println("Enter number of backends available (1-5): ");
    while(Serial.available()) Serial.read(); // clear buffer

    String input = "";
    while(true){
        if(Serial.available()){
            char c = Serial.read();
            if(c == '\n' || c == '\r') {
                if (input.length() > 0) break;
                else continue;
            }
            input += c;
        }
        delay(10); // to prevent watchdog timeout errors
    }
    int n = input.toInt();
    if (n < 1) n = 1;
    if (n > 5) n = 5;
    return n;
}

int get_strategy_choice(){
    Serial.println("Select Load Balancing Strategy (1: Round Robin, 2: Q-Learning, 3: EMA Response Time): ");
    while(Serial.available()) Serial.read(); // clear buffer

    String input = "";
    while(true){
        if(Serial.available()){
            char c = Serial.read();
            if(c == '\n' || c == '\r') {
                if (input.length() > 0) break;
                else continue;
            }
            input += c;
        }
        delay(10); // to prevent watchdog timeout errors
    }
    int choice = input.toInt();
    if (choice < 1 || choice > 3) choice = 1;
    return choice;
}
