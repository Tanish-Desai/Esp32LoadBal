import socket
import threading
import time

class ManagedServer(threading.Thread):
    def __init__(self, ip_address, port, event_callback=None, latency=0.0):
        super().__init__()
        self.ip_address = ip_address
        self.port = port
        self.server_socket = None
        self.running = False
        self.stalled = False
        self.latency = latency
        self.max_timeout = 2.0 # 2.0 corresponds to default client timeout
        self.client_threads = []
        self.active_sockets = []
        self.max_clients = 5
        self.event_callback = event_callback
        self.daemon = True # Closes when main thread closes

    def log_event(self, action, details=""):
        # Send telemetry to the UI (action like "START", "REQUEST", "STOP")
        if self.event_callback:
            self.event_callback({
                'server_port': self.port,
                'action': action,
                'details': details,
                'timestamp': time.time()
            })
        print(f"[Server:{self.port}] {action} - {details}")

    def run(self):
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        
        try:
            self.server_socket.bind((self.ip_address, self.port))
            self.server_socket.listen(self.max_clients)
            self.server_socket.settimeout(1.0)
            self.running = True
            self.log_event("START", f"Listening on {self.ip_address}:{self.port}")
        except Exception as e:
            self.log_event("ERROR", f"Failed to bind: {e}")
            return

        while self.running:
            if self.stalled:
                time.sleep(0.5) # Still running but not accepting
                continue
                
            try:
                client_socket, client_address = self.server_socket.accept()
                self.log_event("CONNECT", f"Client connected: {client_address}")
                
                client_thread = threading.Thread(target=self.handle_request, args=(client_socket, client_address))
                client_thread.daemon = True
                self.client_threads.append(client_thread)
                client_thread.start()
            except socket.timeout:
                continue
            except Exception as e:
                # If socket is manually closed, this handles the exception
                if self.running:
                    self.log_event("ERROR", str(e))
                break

        # Closure cleanup
        self.log_event("STOP", "Server stopping...")
        for sock in self.active_sockets:
            try: sock.close()
            except: pass
        for t in self.client_threads:
            t.join(timeout=1.0)
        try: self.server_socket.close()
        except: pass

    def handle_request(self, client_socket, client_address):
        self.active_sockets.append(client_socket)
        try:
            client_socket.settimeout(2.0) # Prevents infinite block on recv
            while self.running and not self.stalled:
                try:
                    request = client_socket.recv(1024)
                except socket.timeout:
                    continue # Check if self.running still True
                    
                if not request:
                    self.log_event("DISCONNECT", f"Client disconnected: {client_address}")
                    break
                
                req_text = request.decode('utf-8', errors='ignore').split('\n')[0].strip()
                self.log_event("REQUEST", f"Request: {req_text}")

                # Simulate artificial latency based on percentage
                if self.latency > 0:
                    time.sleep((float(self.latency) / 100.0) * self.max_timeout)

                http_response = (
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: text/plain\r\n"
                    "Connection: keep-alive\r\n"
                    "\r\n"
                    f"Hello from Server on port {self.port}!\n"
                )
                client_socket.sendall(http_response.encode('utf-8'))
        except Exception as e:
            self.log_event("ERROR", f"Connection error: {e}")
        finally:
            try: client_socket.close()
            except: pass
            if client_socket in self.active_sockets:
                self.active_sockets.remove(client_socket)

    def stall(self):
        self.stalled = True
        self.log_event("STALL", "Server stalled (ignoring new connections)")

    def resume(self):
        self.stalled = False
        self.log_event("RESUME", "Server resumed")

    def stop(self):
        self.running = False
        self.log_event("STOP", "Triggering stop sequence...")
        if self.server_socket:
            try:
                # Forcefully close active clients so threads exit quickly
                for sock in self.active_sockets:
                    sock.close()
                # Break the blocking accept by connecting to itself
                dummy = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                dummy.connect((self.ip_address, self.port))
                dummy.close()
            except Exception as e:
                pass
        # Wait a moment for OS to free port
        time.sleep(0.5)

if __name__ == "__main__":
    ip = input("IP: ")
    port = int(input("Port: "))
    # Minimal example of running the OOP server standalone
    srv = ManagedServer(ip, port)
    srv.start()
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        srv.stop()