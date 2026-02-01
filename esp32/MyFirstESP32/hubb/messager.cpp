#include <Arduino.h>
#include <WiFi.h>

#define LED 2

const char* ssid = "Superhungry";
const char* password = "tea34320";

WiFiServer server(80); // 80 is standard HTTP port

void setup() {
    Serial.begin(115200);

    // Wi-Fi connection
    Serial.print("Connecting to ");
    Serial.println(ssid);
    WiFi.begin(ssid, password);
 
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }

    Serial.println("");
    Serial.println("WiFi connected.");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());

    server.begin();
    pinMode(LED, OUTPUT);
}

void loop() {
    WiFiClient client = server.available();

    if (client) {
        Serial.println("New Client connected");
        digitalWrite(LED, LOW);
        
        while (client.connected()) {
            if (client.available()) {
                String line = client.readStringUntil('\n');
                Serial.print("Received: ");
                Serial.println(line);
                
                // Send Ping back
                client.println("Ping");
            }
        }
        
        client.stop();
        Serial.println("Client disconnected");
    }
}

// put function definitions here:
void blink(){
    digitalWrite(LED, LOW);
    delay(100);
    digitalWrite(LED, HIGH);
    delay(100);
    digitalWrite(LED, LOW);
    delay(100);
}