# ESP32 RL-based Load Balancer

A Proof-of-Concept implementation of a Wi-Fi-based Reverse Proxy and Reinforcement Learning Load Balancer using the ESP32.

This project demonstrates how an embedded device can act as a **Gateway** between a client and multiple backend servers. It sits in the middle, accepts incoming connections, and distributes traffic to backend servers using intelligent algorithms like Q-Learning and Exponential Moving Average (EMA) of response times, alongside a basic Round-Robin fallback.

## 🏗 Architecture

**Client** (Browser/Script) ➡️ **ESP32** (Gateway) 🔀 **Backend Servers** (Python on Laptop)

- **Role:** The ESP32 acts as a **Reverse Proxy**. To the client, the ESP32 *is* the server. To the server, the ESP32 is the client.
  
- **Layer 7 Capabilities:** The ESP32 inspects packet content (e.g., looking for termination strings like "END") rather than just blindly forwarding packets.
  
- **Concurrency Limitations:** Due to the ESP32's hardware socket limits, the gateway supports a strict maximum of **7 concurrent proxy sessions**.
  

## 🚀 Features

- **Dynamic Network Setup (WiFiManager):** No more hardcoding credentials! The ESP32 spins up a captive portal to securely enter Wi-Fi credentials and the target laptop's IP address, saving them to non-volatile storage (NVS).
  
- **Multiple Load Balancing Strategies (Configurable at Boot):**
  
  - **Q-Learning:** A reinforcement learning approach that explores and exploits servers based on performance rewards.
    
  - **EMA Response Time:** Tracks the Exponential Moving Average of latency for each backend and actively routes traffic to the fastest available server.
    
  - **Round-Robin:** A simple, deterministic sequential distribution fallback.
    
- **Non-Blocking I/O:** Uses a **1KB Buffer** to stream data between client and server without blocking the main loop or exhausting RAM.
  
- **Management UI Dashboard:** A rich, dark-mode compatible Flask web application leveraging WebSockets. Features include:
  
  - **Advanced Real-time Telemetry:** Dual Chart.js visualizations displaying **Total Period Requests** (to gauge overall throughput and visualize average response times) and **Server Requests in Period** (to monitor live load distribution). Includes adjustable chart refresh rates.
    
  - **Live Statistics & Logs:** An active request stream console and dynamic statistic cards tracking total requests and individual server performance metrics.
    
  - **Dynamic Control:** Spawn backend servers on specific ports, inject artificial latency for stress testing algorithms, and manage multi-threaded mock clients on the fly.
    

## 🛠️ Tech Stack

- **Hardware:** ESP32 Development Board (DOIT DevKit V1)
  
- **Firmware:** C++ (PlatformIO / Arduino Framework)
  
  - Libraries: `WiFiManager`, `Preferences`
- **Backend:** Python 3 (Socket, Threading)
  
- **Frontend UI:** Flask, HTML/JS, Tailwind CSS, Chart.js, Flask-SocketIO (Real-time telemetry)
  

## ⚙️ Setup & Usage

### 1. Start the Backend Dashboard

1. Install the required Python dependencies:
  
  ```
  pip install flask flask-socketio
  ```
  
2. Start the web application:
  
  ```
  python ui/app.py
  ```
  
3. Open `http://localhost:5000` in your browser. From here, you can dynamically create backend servers on specific ports (e.g., `8080`, `8081`) and inject artificial latency for testing. Note your laptop's Local IP displayed at the top of the dashboard.
  

### 2. Configure & Flash the Firmware

1. Compile and upload the firmware to your ESP32 using PlatformIO.
  
2. Open the **Serial Monitor** at baud rate `115200`.
  

### 3. Connect to the Captive Portal

1. If the ESP32 doesn't have saved Wi-Fi credentials, it will broadcast an access point named **"ESP32 Web Portal"**.
  
2. Connect to this Wi-Fi network using your phone or laptop.
  
3. A captive portal will pop up (or navigate to `192.168.4.1`). Enter your local Wi-Fi SSID, Password, and your **Laptop's IP Address** (from step 1).
  

### 4. Interactive Boot Configuration

Once connected to Wi-Fi, the ESP32 will pause and wait for input via the **Serial Monitor**. Follow the prompts:

1. **Laptop IP:** Press *Enter* to keep the saved IP or type a new one.
  
2. **Backends:** Enter the number of backend servers you spawned in the UI (1-5).
  
3. **Strategy:** Enter `1` for Round Robin, `2` for Q-Learning, or `3` for EMA Response Time.
  

### 5. Simulate Traffic

Once the ESP32 prints its local IP address and begins listening, use the **Mock Clients** section in the web UI to spawn clients targeting the ESP32's IP. Watch the dashboard to see how the load balancer distributes the traffic based on your selected algorithm!

## 🐛 Troubleshooting & "Gotchas"

**"My ESP32 can't connect to the Python Server!"**

If the ESP32 fails to connect to the backend, check your Windows Network settings.

- **The Issue:** Windows Firewall often blocks incoming connections on private ports (8080-8084) if the Wi-Fi network is set to **"Public"**.
  
- **The Fix:** Change your Wi-Fi network profile from **Public** to **Private** in Windows settings, or run the provided PowerShell utility (right-click -> Run with PowerShell):
  
  - `misc_tools/disable_priv_firewall.ps1` (This will prompt for elevation and allow you to quickly disable/enable the private firewall profile).