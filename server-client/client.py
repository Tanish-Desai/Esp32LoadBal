import socket
import threading
import time

class MockClient(threading.Thread):
    def __init__(self, target_ip, target_port, client_id, delay=1.0, event_callback=None):
        super().__init__()
        self.target_ip = target_ip
        self.target_port = target_port
        self.client_id = client_id
        self.delay = delay
        self.running = False
        self.socket = None
        self.event_callback = event_callback
        self.daemon = True

    def log_event(self, action, details=""):
        if self.event_callback:
            self.event_callback({
                'client_id': self.client_id,
                'action': action,
                'details': details,
                'timestamp': time.time()
            })
        print(f"[Client:{self.client_id}] {action} - {details}")

    def run(self):
        self.running = True
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.settimeout(2.0)
        
        try:
            self.log_event("CONNECTING", f"Connecting to {self.target_ip}:{self.target_port}")
            self.socket.connect((self.target_ip, self.target_port))
            self.log_event("CONNECTED", "Successfully connected")
        except Exception as e:
            self.log_event("ERROR", f"Connection failed: {e}")
            self.running = False
            return

        try:
            msg = f"GET /ping/{self.client_id}/0 HTTP/1.1\r\nHost: {self.target_ip}\r\n\r\n"
            self.socket.sendall(msg.encode('utf-8'))
            self.log_event("PING", f"Sent: /ping/{self.client_id}/0")
            
            # Wait for response (timeout is handled by socket.settimeout(2.0))
            response = self.socket.recv(1024)
            if not response:
                print(f"[Client:{self.client_id}] TERMINATION REASON: Connection closed by server before ACK")
                self.log_event("DISCONNECTED", "Connection closed by server")
            else:
                resp_text = response.decode('utf-8', errors='ignore').split('\n')[0].strip()
                self.log_event("PONG", f"Received: {resp_text}")
                
                if "200 OK" in resp_text:
                    print(f"[Client:{self.client_id}] TERMINATION REASON: ACK (200 OK) received")
                else:
                    print(f"[Client:{self.client_id}] TERMINATION REASON: Received non-200 response")
                    
        except socket.timeout:
            print(f"[Client:{self.client_id}] TERMINATION REASON: Timeout reached")
            self.log_event("TIMEOUT", "Socket operation timed out")
        except Exception as e:
            if self.running:
                print(f"[Client:{self.client_id}] TERMINATION REASON: Communication error ({e})")
                self.log_event("ERROR", f"Communication error: {e}")

        self.running = False
        try:
            self.socket.close()
        except:
            pass
        self.log_event("STOP", "Client thread finished")
        
    def stop(self):
        self.running = False
        if self.socket:
            try:
                self.socket.close()
            except:
                pass
