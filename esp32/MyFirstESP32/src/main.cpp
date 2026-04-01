#include <WiFi.h>
#include<WiFiManager.h>
#include<Preferences.h>

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
const int MAX_CLIENTS = 10;
WiFiClient g_clients[MAX_CLIENTS];
WiFiClient g_backends[MAX_CLIENTS];
// -----------------------------------------------

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
    
    num_backends = get_num_backends();
    Serial.printf("Configured for %d backends.\n", num_backends);
}

void loop() {
    // 1. Check for ANY new incoming client
    WiFiClient newClient = publicServer.available();

    if (newClient) {
        Serial.println("New connection request received...");
        bool assigned = false;
        static int current_backend_idx = 0;
        
        for (int i = 0; i < MAX_CLIENTS; i++) {
            if (!g_clients[i] || !g_clients[i].connected()) {
                Serial.printf("Assigning to Slot %d\n", i + 1);
                g_clients[i] = newClient; // Move connection to global
                
                // Connect Backend
                bool backend_connected = false;
                for (int j = 0; j < num_backends; j++) {
                    int port_idx = (current_backend_idx + j) % num_backends;
                    if (g_backends[i].connect(server_ip.c_str(), backend_ports[port_idx])) {
                        Serial.printf("Backend Connected (Port %d)\n", backend_ports[port_idx]);
                        backend_connected = true;
                        current_backend_idx = (port_idx + 1) % num_backends;
                        break;
                    } else {
                        Serial.printf("Backend Failed on Port %d. Trying next...\n", backend_ports[port_idx]);
                    }
                }

                if (!backend_connected) {
                    Serial.println("All backends failed. Please enter correct Laptop IP:");
                    String new_ip = set_server_ip();
                    if(new_ip.length() > 0) {
                        server_ip = new_ip;
                        preferences.putString("server_ip", server_ip);
                        Serial.println("Saved new server IP: " + server_ip);
                    }
                    g_clients[i].stop();
                }
                
                assigned = true;
                break;
            }
        }
        
        if (!assigned) {
            Serial.println("Server Full! Rejecting client.");
            newClient.stop();
        }
    }

    // 2. Handle Data Traffic for all slots
    for (int i = 0; i < MAX_CLIENTS; i++) {
        if (g_clients[i] && g_clients[i].connected() && g_backends[i] && g_backends[i].connected()) {
            talk(g_clients[i], g_backends[i]);
            talk(g_backends[i], g_clients[i]);
        } else {
            if (g_clients[i]) g_clients[i].stop();
            if (g_backends[i]) g_backends[i].stop();
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
            if(c == '\n') break;
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