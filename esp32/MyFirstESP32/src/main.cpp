#include <WiFi.h>

// --- Configuration ---
const char* ssid = "Superhungry";
const char* password = "tea34320";

// The "Real" Server (Your Laptop)
const char* backend_ip = "10.176.160.78"; // CHANGE THIS to your laptop's IP
const int backend_port = 8080;            // The port your laptop server listens on

// The ESP32 Load Balancer Port
const int listen_port = 80;

WiFiServer publicServer(listen_port);

void setup() {
    Serial.begin(115200);

    // 1. Connect to WiFi
    Serial.print("Connecting to WiFi");
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nWiFi Connected.");
    Serial.print("ESP32 Load Balancer IP: ");
    Serial.println(WiFi.localIP());

    // 2. Start listening for Clients
    publicServer.begin();
}

void loop() {
    // Check if a client has connected to the ESP32
    WiFiClient client = publicServer.available();

    if (client) {
        Serial.println("New Client Connected to ESP32.");

        // Attempt to connect to the Backend Server (Laptop)
        WiFiClient backend;
        if (backend.connect(backend_ip, backend_port)) {
            Serial.println("Connected to Backend Server. Bridging traffic...");

            // --- The Bridge Loop ---
            // Keep looping while both sides are connected
            while (client.connected() && backend.connected()) {
                // 1. Client -> ESP32 -> Backend
                if (client.available()) {
                    char c = client.read();
                    backend.write(c);
                }

                // 2. Backend -> ESP32 -> Client
                if (backend.available()) {
                    char c = backend.read();
                    client.write(c);
                }
            }
            backend.stop();
            Serial.println("Session Closed.");
        } else {
            Serial.println("Failed to connect to Backend Server.");
            client.println("HTTP/1.1 502 Bad Gateway");
            client.println("Connection: close");
            client.println();
        }
        client.stop();
    }
}