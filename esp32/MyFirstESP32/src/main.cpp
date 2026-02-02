#include <WiFi.h>
#include<WiFiManager.h>

// The "Real" Server (Your Laptop)
const char* backend_ip1 = "10.138.112.78"; // CHANGE THIS to your laptop's IP
const int backend_port1 = 8080;            // The port your laptop server listens on

const char* backend_ip2 = backend_ip1;
const int backend_port2 = 8081;

// The ESP32 Load Balancer Port
const int listen_port = 80;

// Define a buffer size (Standard Ethernet packet is ~1500, so 1024 is safe)
const int buffSize = 1024;
uint8_t buffer[buffSize];

bool server2 = false;
WiFiServer publicServer(listen_port);

void setup() {
    Serial.begin(115200);

    WiFiManager wm;
    bool success = wm.autoConnect("ESP32 Web Portal");
    if(!success){
        Serial.println("Failed to connect or hit timeout");
        // ESP.restart();
    }else{
        Serial.println("\n\nConnected...");
        Serial.print("Local IP Address: ");
        Serial.println(WiFi.localIP());
    }

    // 2. Start listening for Clients
    publicServer.begin();
}

void loop() {
    // Check if a client has connected to the ESP32
    WiFiClient client = publicServer.available();

    if (client) {

        // potato load balancer (simply switches servers for each client)
        server2 = !server2; 
        Serial.print("Server switched to ");
        Serial.println(server2?8081:8080);

        Serial.println("\nNew Client Connected to ESP32.");

        // Attempt to connect to the Backend Server (Laptop)
        WiFiClient backend;

        // Load Balancing: (const as compiler doesn't allow otherwise)
        const char* backend_ip = server2 ? backend_ip2 : backend_ip1;
        const int backend_port = server2 ? backend_port2 : backend_port1;

        if (backend.connect(backend_ip, backend_port)) {
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
            client.println("HTTP/1.1 502 Bad Gateway");
            client.println("Connection: close");
            client.println();
        }
        client.stop();
    }
}