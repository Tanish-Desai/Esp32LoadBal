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

// Define a buffer size
const int buffSize = 1024;
uint8_t buffer[buffSize];

// temporary server_ip string for portal purposes
String server_ip;
Preferences preferences;
String set_server_ip();

WiFiServer publicServer(listen_port);

// --- GLOBAL CLIENTS TO KEEP CONNECTION ALIVE ---
WiFiClient g_client1;
WiFiClient g_backend1;

WiFiClient g_client2;
WiFiClient g_backend2;
// -----------------------------------------------

// Forward Declaring funcs
void talk(WiFiClient& c1, WiFiClient& c2);

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
    
    // Set backend IPs here once
    backend_ip1 = server_ip;
    backend_ip2 = server_ip;
}

void loop() {
    // 1. Check for ANY new incoming client
    WiFiClient newClient = publicServer.available();

    if (newClient) {
        Serial.println("New connection request received...");
        
        // Try to assign to Slot 1
        if (!g_client1 || !g_client1.connected()) {
            Serial.println("Assigning to Slot 1 (Port 8080)");
            g_client1 = newClient; // Move connection to global
            
            // Connect Backend 1
            if (g_backend1.connect(backend_ip1.c_str(), backend_port1)) {
                Serial.println("Backend 1 Connected");
            } else {
                Serial.printf("Backend 1 Failed (%s:%d). Trying Backend 2...\n", backend_ip1.c_str(), backend_port1);
                if (g_backend1.connect(backend_ip2.c_str(), backend_port2)) {
                    Serial.println("Connected to Backend 2 instead");
                } else {
                    Serial.println("Backend 2 also failed. Please enter correct Laptop IP:");
                    String new_ip = set_server_ip();
                    if(new_ip.length() > 0) {
                        server_ip = new_ip;
                        backend_ip1 = server_ip;
                        backend_ip2 = server_ip;
                        preferences.putString("server_ip", server_ip);
                        Serial.println("Saved new server IP: " + server_ip);
                    }
                    g_client1.stop();
                }
            }
        }
        // If Slot 1 is busy, try Slot 2
        else if (!g_client2 || !g_client2.connected()) {
            Serial.println("Assigning to Slot 2 (Port 8081)");
            g_client2 = newClient; // Move connection to global

            // Connect Backend 2
            if (g_backend2.connect(backend_ip2.c_str(), backend_port2)) {
                Serial.println("Backend 2 Connected");
            } else {
                Serial.printf("Backend 2 Failed (%s:%d). Trying Backend 1...\n", backend_ip2.c_str(), backend_port2);
                if (g_backend2.connect(backend_ip1.c_str(), backend_port1)) {
                    Serial.println("Connected to Backend 1 instead");
                } else {
                    Serial.println("Backend 1 also failed. Please enter correct Laptop IP:");
                    String new_ip = set_server_ip();
                    if(new_ip.length() > 0) {
                        server_ip = new_ip;
                        backend_ip1 = server_ip;
                        backend_ip2 = server_ip;
                        preferences.putString("server_ip", server_ip);
                        Serial.println("Saved new server IP: " + server_ip);
                    }
                    g_client2.stop();
                }
            }
        }
        else {
            Serial.println("Server Full! Rejecting client.");
            newClient.stop();
        }
    }

    // 2. Handle Data Traffic for Slot 1
    if (g_client1.connected() && g_backend1.connected()) {
        talk(g_client1, g_backend1);
        talk(g_backend1, g_client1);
    } else {
        // Clean up if one side disconnects
        if (g_client1) g_client1.stop();
        if (g_backend1) g_backend1.stop();
    }

    // 3. Handle Data Traffic for Slot 2
    if (g_client2.connected() && g_backend2.connected()) {
        talk(g_client2, g_backend2);
        talk(g_backend2, g_client2);
    } else {
        // Clean up if one side disconnects
        if (g_client2) g_client2.stop();
        if (g_backend2) g_backend2.stop();
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