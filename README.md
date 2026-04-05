# ESP32 RL-based Load Balancer

A Proof-of-Concept implementation of a Wi-Fi-based Reverse Proxy and Reinforcement Learning Load Balancer using the ESP32.

This project demonstrates how an embedded device can act as a **Gateway** between a client and multiple backend servers. It sits in the middle, accepts incoming connections, and distributes traffic to backend servers using Reinforcement Learning (Q-Learning) and a basic Round-Robin algorithm.

## 🏗 Architecture

**Client** (Browser/Script)  ➡️  **ESP32** (Gateway)  🔀  **Backend Servers** (Python on Laptop)

* **Role:** The ESP32 acts as a **Reverse Proxy**. To the client, the ESP32 *is* the server. To the server, the ESP32 is the client.
* **Layer 7 Capabilities:** The ESP32 inspects packet content (e.g., looking for termination strings like "END") rather than just blindly forwarding packets.

## 🚀 Features

* **Reinforcement Learning (Q-Learning) Load Balancing:** Implements a smarter routing strategy based on server feedback and performance.
* **Basic Round-Robin Load Balancing:** Can fall back to a simple Round-Robin strategy.
* **Non-Blocking I/O:** Uses a **1KB Buffer** to stream data between client and server without blocking the main loop or exhausting RAM.
* **Traffic Inspection:** Scans incoming payloads for specific keywords (e.g., "END") to handle connection termination dynamically.
* **Backend:** Simple Python TCP server scripts used to simulate the backend nodes.
* **Management UI:** A Flask-based web application (with WebSockets) to visualize, start, stop, and manage the Python backend server nodes, as well as simulate mock clients.

## 🛠️ Tech Stack

* **Hardware:** ESP32 Development Board (DOIT DevKit V1)
* **Firmware:** C++ (PlatformIO / Arduino Framework)
* **Backend:** Python 3 (Socket, Flask, Server/Client Threads)
* **Frontend UI:** HTML/JS with Flask-SocketIO for real-time telemetry

## ⚙️ Setup & Usage

1.  **Configure Firmware:**
    * Open `esp32/MyFirstESP32/src/main.cpp`.
    * Update `ssid` and `password` with your Wi-Fi credentials.
    * Set `backend_ip1` to your laptop's local IP address.
2.  **Run Backends (via UI):**
    * Install dependencies using `pip install flask flask-socketio`.
    * Start the web application: `python ui/app.py`.
    * Open `http://localhost:5000` to manage your server instances (`8080`, `8081`).
3.  **Deploy:**
    * Upload the firmware code to the ESP32.
    * Monitor the Serial Output (baud `115200`) to get the ESP32's IP address.
4.  **Connect:**
    * Visit `http://<ESP32_IP>` in your browser, or use the Mock Clients from the web UI to visualize traffic.

## 🐛 Troubleshooting & "Gotchas"

**"My ESP32 can't connect to the Python Server!"**
If the ESP32 fails to connect to the backend, check your Windows Network settings.
* **The Issue:** Windows Firewall often blocks incoming connections on private ports (8080/8081) if the Wi-Fi network is set to **"Public"**.
* **The Fix:** Change your Wi-Fi network profile from **Public** to **Private** in Windows settings, or run the provided PowerShell utility:
  * `misc_tools/disable_priv_firewall.ps1` (This will prompt for elevation, and allow you to quickly disable/enable the private firewall profile).
