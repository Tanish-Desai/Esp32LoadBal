import sys
import os
import time
import base64
import uuid
import threading
import socket
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

# Ensure server-client folder is in path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'server-client')))
from server import ManagedServer
from client import MockClient

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config['SECRET_KEY'] = 'secret!'
# Use threading to ensure standard Python threads from server.py can emit events correctly
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Doesn't need to be reachable, just forces the OS to resolve the local IP routed to internet
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# State
servers = {} # port -> ManagedServer instance
clients = {} # id -> MockClient instance

# WebSockets Callbacks
def server_event_callback(data):
    # data is a dict: {server_port, action, details, timestamp}
    socketio.emit('server_event', data)

def client_event_callback(data):
    # data is a dict: {client_id, action, details, timestamp}
    socketio.emit('client_event', data)


@app.route('/')
def index():
    return render_template('index.html', laptop_ip=get_local_ip())

# --- Server APIs ---

@app.route('/api/servers', methods=['GET'])
def get_servers():
    out = []
    for port, srv in servers.items():
        out.append({
            'port': port,
            'ip': srv.ip_address,
            'running': srv.running,
            'stalled': srv.stalled,
            'max_clients': srv.max_clients
        })
    return jsonify(out)

@app.route('/api/servers/create', methods=['POST'])
def create_server():
    data = request.json
    port = int(data.get('port'))
    ip = data.get('ip', '0.0.0.0')
    
    if port in servers:
        return jsonify({'error': f'Server on port {port} already exists'}), 400
        
    srv = ManagedServer(ip, port, event_callback=server_event_callback)
    servers[port] = srv
    return jsonify({'status': 'success', 'port': port})

@app.route('/api/servers/<int:port>/start', methods=['POST'])
def start_server(port):
    if port not in servers:
        return jsonify({'error': 'Server not found'}), 404
        
    srv = servers[port]
    if not srv.running:
        srv.start()
        # Sleep slightly to let socket bind
        time.sleep(0.1)
    return jsonify({'status': 'started'})

@app.route('/api/servers/<int:port>/stop', methods=['POST'])
def stop_server(port):
    if port not in servers:
        return jsonify({'error': 'Server not found'}), 404
    servers[port].stop()
    return jsonify({'status': 'stopped'})

@app.route('/api/servers/<int:port>/stall', methods=['POST'])
def stall_server(port):
    if port not in servers:
        return jsonify({'error': 'Server not found'}), 404
    servers[port].stall()
    return jsonify({'status': 'stalled'})

@app.route('/api/servers/<int:port>/resume', methods=['POST'])
def resume_server(port):
    if port not in servers:
        return jsonify({'error': 'Server not found'}), 404
    servers[port].resume()
    return jsonify({'status': 'resumed'})

@app.route('/api/servers/<int:port>/delete', methods=['DELETE'])
def delete_server(port):
    if port in servers:
        servers[port].stop()
        del servers[port]
    return jsonify({'status': 'deleted'})

# --- Client APIs ---

@app.route('/api/clients', methods=['GET'])
def get_clients():
    out = []
    for cid, client in clients.items():
        out.append({
            'id': cid,
            'target_ip': client.target_ip,
            'target_port': client.target_port,
            'running': client.running,
            'delay': client.delay
        })
    return jsonify(out)

@app.route('/api/clients/create', methods=['POST'])
def create_client():
    data = request.json
    target_ip = data.get('target_ip', '127.0.0.1')
    target_port = int(data.get('target_port', 80))
    delay = float(data.get('delay', 1.0))
    
    cid = str(uuid.uuid4())[:8]
    client = MockClient(target_ip, target_port, cid, delay=delay, event_callback=client_event_callback)
    clients[cid] = client
    
    # Auto-start client
    client.start()
    return jsonify({'status': 'success', 'id': cid})

@app.route('/api/clients/<client_id>/stop', methods=['POST'])
def stop_client(client_id):
    if client_id not in clients:
        return jsonify({'error': 'Client not found'}), 404
    clients[client_id].stop()
    del clients[client_id]
    return jsonify({'status': 'stopped'})


if __name__ == '__main__':
    # Run using eventlet or native depending on environment
    socketio.run(app, debug=True, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
