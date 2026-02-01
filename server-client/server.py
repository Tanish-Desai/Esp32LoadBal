import socket

# Create a socket object
server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

# Allow immediate reuse of the port (prevents "Address already in use" errors after restarting)
server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

# Bind the socket to port 8080 on all network interfaces
server_socket.bind(('0.0.0.0', 8080))

# Listen for incoming connections
server_socket.listen(1)

print("Server listening on port 8080... (Press Ctrl+C to stop)")

while True:
    try:
        # Accept one client connection
        client_socket, client_address = server_socket.accept()
        print(f"Client connected from {client_address}")

        # Receive data (The HTTP Request from ESP32)
        request = client_socket.recv(1024)
        print(f"Received Request:\n{request.decode('utf-8', errors='ignore')}")

        # Send a standard HTTP Response back
        http_response = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/plain\r\n"
            "Connection: close\r\n"
            "\r\n"
            "Hello! The Load Balancer successfully forwarded you to the Laptop."
        )
        client_socket.sendall(http_response.encode('utf-8'))

        # Close the connection with this specific client
        client_socket.close()
        print("Client connection closed.\n")

    except KeyboardInterrupt:
        print("\nServer stopping...")
        break
    except Exception as e:
        print(f"Error: {e}")

server_socket.close()