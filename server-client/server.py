import socket

# SERVER 1: PORT 8080
# SERVER 2: PORT 8081

port = int(input("Port: "))

# Create a socket object
server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

# Allow immediate reuse of the port (prevents "Address already in use" errors after restarting)
server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

# Bind the socket to given port on all network interfaces
server_socket.bind(('0.0.0.0', port))

# Listen for incoming connections
server_socket.listen(1)

print(f"Server listening on port {port}... (Press Ctrl+C to stop)")

while True:
    try:
        # Accept one client connection
        client_socket, client_address = server_socket.accept()
        print(f"Client connected from {client_address}")
        
        # Handle multiple messages from the same client
        while True:
            # Receive data (The HTTP Request from ESP32)
            request = client_socket.recv(1024)
            
            # If no data is received, client has disconnected
            if not request:
                print("Client disconnected.\n")
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

    except KeyboardInterrupt:
        print("\nServer stopping...")
        break
    except Exception as e:
        print(f"Error: {e}")

server_socket.close()