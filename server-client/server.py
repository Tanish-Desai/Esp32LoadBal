import socket
import threading

def server_init(ip_address, port):
    # SERVER 1: PORT 8080
    # SERVER 2: PORT 8081

    # Create a socket object
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    # Allow immediate reuse of the port (prevents "Address already in use" errors after restarting)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    # Bind the socket to given port on all network interfaces
    server_socket.bind((ip_address, port))

    # Listen for incoming connections
    server_socket.listen(1)

    # Set a timeout so KeyboardInterrupt can be handled properly
    server_socket.settimeout(1.0)

    print(f"[Server listening on port {port}...]")

    # list to store threads that handle clients
    client_threads = []
    
    while True:
        try:
            # Accept one client connection
            try:
                client_socket, client_address = server_socket.accept()
            except socket.timeout:
                # Timeout reached, continue to check for KeyboardInterrupt
                continue
            
            print(f"[Client connected from {client_address}]")
            client_thread = threading.Thread(target=handle_request, args=(client_socket, client_address))
            client_threads.append(client_thread)
            
            client_thread.start()
            
            # # Handle multiple messages from the same client
            # while True:
            #     # Receive data (The HTTP Request from ESP32)
            #     request = client_socket.recv(1024)
                
            #     # If no data is received, client has disconnected
            #     if not request:
            #         print("Client disconnected.\n")
            #         break
                
            #     print(f"Received Request:\n{request.decode('utf-8', errors='ignore')}")

            #     # Send a standard HTTP Response back
            #     http_response = (
            #         "HTTP/1.1 200 OK\r\n"
            #         "Content-Type: text/plain\r\n"
            #         "Connection: keep-alive\r\n"
            #         "\r\n"
            #     )
            #     client_socket.sendall(http_response.encode('utf-8'))

            # # Close the connection with this specific client
            # client_socket.close()

        except KeyboardInterrupt:
            print("\n[Server stopping...]")
            break
        except Exception as e:
            print(f"[Error: {e}]")

    for x in client_threads:
        x.join()
    server_socket.close()

def handle_request(client_socket, client_address):
    # Handle multiple messages from the same client
    while True:
        # Receive data (The HTTP Request from ESP32)
        request = client_socket.recv(1024)
        
        # If no data is received, client has disconnected
        if not request:
            print("[Client disconnected.]\n")
            break
        
        print(f"Received Request:\n{request.decode('utf-8', errors='ignore')}")

        # Send a standard HTTP Response back
        http_response = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/plain\r\n"
            "Connection: keep-alive\r\n"
            "\r\n"
        )
        client_socket.sendall(http_response.encode('utf-8'))

    # Close the connection with this specific client
    client_socket.close()

if __name__ == "__main__":
    # 127.0.0.1 for local testing
    # 0.0.0.0 to listen to all interfaces (ESP32)
    ip = input("IP: ")
    port = int(input("Port: "))
    server_init(ip, port)