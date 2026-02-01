# ESP32 Load Balancer & Reverse Proxy

A Proof-of-Concept implementation of a Wi-Fi-based Reverse Proxy and Load Balancer using the ESP32.

This project demonstrates how an embedded device can act as a **Gateway** between a client and multiple backend servers. It sits in the middle, accepts incoming connections, and distributes traffic to backend servers (running on a laptop) using a basic Round-Robin algorithm.

## 🏗 Architecture

**Client** (Browser/Script)  ➡️  **ESP32** (Gateway)  🔀  **Backend Servers** (Python on Laptop)

* **Role:** The ESP32 acts as a **Reverse Proxy**. To the client, the ESP32 *is* the server. To the server, the ESP32 is the client.
* **Layer 7 Capabilities:** The ESP32 inspects packet content (e.g., looking for termination strings like "END") rather than just blindly forwarding packets.

## 🚀 Features

* **"Potato" Load Balancing:** Implements a simple **Round-Robin** strategy.
    * Client 1 ➡️ Forwarded to Port `8080`
    * Client 2 ➡️ Forwarded to Port `8081`
    * (Repeats)
* **Non-Blocking I/O:** Uses a **1KB Buffer** to stream data between client and server without blocking the main loop or exhausting RAM.
* **Traffic Inspection:** Scans incoming payloads for specific keywords (e.g., "END") to handle connection termination dynamically.
* **Backend:** Simple Python TCP server scripts used to simulate the backend nodes.

## 🛠️ Tech Stack

* **Hardware:** ESP32 Development Board (DOIT DevKit V1)
* **Firmware:** C++ (PlatformIO / Arduino Framework)
* **Backend:** Python 3 (Socket programming)

## ⚙️ Setup & Usage

1.  **Configure Firmware:**
    * Open `src/main.cpp`.
    * Update `ssid` and `password` with your Wi-Fi credentials.
    * Set `backend_ip1` to your laptop's local IP address.
2.  **Run Backends:**
    * Run the Python server script on your laptop.
    * *Note:* To test the load balancing, you need two server instances running on ports `8080` and `8081`.
3.  **Deploy:**
    * Upload the code to the ESP32.
    * Monitor the Serial Output (baud `115200`) to get the ESP32's IP address.
4.  **Connect:**
    * Visit `http://<ESP32_IP>` in your browser or connect via a TCP client.

## 🐛 Troubleshooting & "Gotchas"

**"My ESP32 can't connect to the Python Server!"**
If the ESP32 fails to connect to the backend, check your Windows Network settings.
* **The Issue:** Windows Firewall often blocks incoming connections on private ports (8080/8081) if the Wi-Fi network is set to **"Public"**.
* **The Fix:** Change your Wi-Fi network profile from **Public** to **Private** in Windows settings, or manually allow the port through the firewall.

## 📄 License

[MIT](LICENSE)
