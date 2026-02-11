#include <WiFi.h>
#include<WiFiManager.h>
#include<Preferences.h>

// The "Real" Server (Your Laptop)
String backend_ip1; // CHANGE THIS to your laptop's IP
const int backend_port1 = 8080;            // The port your laptop server listens on

String backend_ip2;
const int backend_port2 = 8081;

// The ESP32 Load Balancer Port
const int listen_port = 80;

// Define a buffer size (Standard Ethernet packet is ~1500, so 1024 is safe)
const int buffSize = 1024;
uint8_t buffer[buffSize];

// temporary server_ip string for portal purposes
String server_ip;
Preferences preferences;
String set_server_ip();

bool server2 = false;
WiFiServer publicServer(listen_port);

void setup() {
    Serial.begin(115200);

    // Initialize Storage
    preferences.begin("config", false);
    server_ip = preferences.getString("server_ip", "192.168.1.100");

    WiFiManager wm;

    // adds server ip param to portal
    WiFiManagerParameter custom_server_ip("server", "Laptop IP", server_ip.c_str(), 16);
    wm.addParameter(&custom_server_ip);

    bool success = wm.autoConnect("ESP32 Web Portal");
    if(!success){
        Serial.println("Failed to connect or hit timeout");
        // ESP.restart();
    }else{
        Serial.println("\n\nConnected...");
        Serial.print("Local IP Address: ");
        Serial.println(WiFi.localIP());

        server_ip = custom_server_ip.getValue();
        
        // Save the IP from portal to preferences
        preferences.putString("server_ip", server_ip);
    }

    // 2. Start listening for Clients
    publicServer.begin();
}

void loop() {
    // Check if a client has connected to the ESP32
    WiFiClient client = publicServer.available();
    backend_ip1 = server_ip;
    backend_ip2 = server_ip;

    if (client) {

        // potato load balancer (simply switches servers for each client)
        server2 = !server2; 
        Serial.print("Server switched to ");
        Serial.println(server2?8081:8080);

        Serial.println("\nNew Client Connected to ESP32.");

        // Attempt to connect to the Backend Server (Laptop)
        WiFiClient backend;

        // Load Balancing:
        String backend_ip = server2 ? backend_ip2 : backend_ip1;
        const int backend_port = server2 ? backend_port2 : backend_port1;

        if (backend.connect(backend_ip.c_str(), backend_port)) {
            Serial.println("Connected to Backend Server. Bridging traffic...");

            // --- The Bridge Loop ---
            // Keep looping while both sides are connected
            while (client.connected() && backend.connected()) {
                // 1. Client -> Backend (Downstream)
                int lenC = client.available();
                if (lenC > 0) {
                    // Don't read more than the buffer can hold
                    if (lenC > buffSize) lenC = buffSize;
                    
                    // Read into buffer
                    client.read(buffer, lenC);
                    
                    // Write buffer to backend
                    backend.write(buffer, lenC);
                    
                    // (Optional) Print to Serial so you can see the "String"
                    Serial.write(buffer, lenC); 

                    for (int i = 0; i < lenC - 2; i++) {
                        // Check if bytes at i, i+1, i+2 match 'E', 'N', 'D'
                        if (buffer[i] == 'E' && buffer[i+1] == 'N' && buffer[i+2] == 'D') {
                            Serial.println("\n[Control] END received. Terminating.");
                            client.stop(); // This will break the while loop
                            break;
                        }
                    }
                }

                // 2. Backend -> Client (Upstream)
                int lenB = backend.available();
                if (lenB > 0) {
                    if (lenB > buffSize) lenB = buffSize;
                    
                    backend.read(buffer, lenB);
                    client.write(buffer, lenB);
                }
            }
            backend.stop();
            Serial.println("Session Closed.\n");
        } else {
            Serial.println("Failed to connect to Backend Server.");
            Serial.print("Backend IP:Port - ");
            Serial.print(backend_ip);
            Serial.print(":");
            Serial.println(backend_port);

            Serial.print("\nEnter server ip: ");
            server_ip = set_server_ip();
            preferences.putString("server_ip", server_ip);
            Serial.print("\nNew server IP: ");
            Serial.println(server_ip);
        }
        client.stop();
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