#include<Arduino.h>
#include <WiFi.h>
#include<WiFiManager.h>
#include<Preferences.h>

#include <LoadBalancerStrategy.h>
#include <RoundRobin.h>
#include <QLearning.h>

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

    lb_strategy = new RoundRobin(num_backends);
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
                for (int j = 0; j < num_backends; j++) {
                    int port_idx = lb_strategy->getNextBackend();
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
                Serial.printf("Session [Slot %d] ended. Backend: Port %d. Duration: %lu ms\n", 
                              i + 1, backend_ports[sessions[i].backend_idx], duration);
                
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