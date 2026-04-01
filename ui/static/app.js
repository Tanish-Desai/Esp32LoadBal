// app.js

const socket = io();

// State
let servers = [];
let clients = [];

// Chart Setup
const ctx = document.getElementById('trafficChart').getContext('2d');
const chartCfg = {
    type: 'line',
    data: {
        labels: [],
        datasets: [] // Each server gets a dataset {label: "Port 8080", data: []}
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                title: { display: true, text: 'Time' },
                ticks: { display: false } // hide raw timestamps for clean look
            },
            y: {
                title: { display: true, text: 'Requests / Sec' },
                min: 0,
                suggestedMax: 10
            }
        },
        animation: { duration: 0 } // Fast updates
    }
};
const trafficChart = new Chart(ctx, chartCfg);

// Socket IO Events
socket.on('connect', () => {
    const el = document.getElementById('socket-status');
    el.textContent = 'Live';
    el.className = 'px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium';
    refreshState();
});

socket.on('disconnect', () => {
    const el = document.getElementById('socket-status');
    el.textContent = 'Disconnected';
    el.className = 'px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium';
});

// Traffic Tracking
const currentRequestCounts = {}; // { port: count }
setInterval(() => {
    // Tick the chart every 1 second
    const now = new Date().toLocaleTimeString();
    trafficChart.data.labels.push(now);

    servers.forEach(srv => {
        let dataset = trafficChart.data.datasets.find(d => d.label === `Server ${srv.port}`);
        if (!dataset) {
            dataset = {
                label: `Server ${srv.port}`,
                data: [],
                borderColor: `hsl(${Math.random() * 360}, 70%, 50%)`,
                tension: 0.2, // Smooth lines
                fill: true,
                backgroundColor: 'rgba(0,0,0,0.05)'
            };
            trafficChart.data.datasets.push(dataset);
        }
        dataset.data.push(currentRequestCounts[srv.port] || 0);
        // Reset counter
        currentRequestCounts[srv.port] = 0;
    });

    // Keep last 60 seconds
    if (trafficChart.data.labels.length > 60) {
        trafficChart.data.labels.shift();
        trafficChart.data.datasets.forEach(d => d.data.shift());
    }
    
    trafficChart.update();
}, 1000);


// Server Events
socket.on('server_event', (data) => {
    // Ex: {server_port, action: 'REQUEST', details, timestamp}
    appendLog(`[SERVER:${data.server_port}] ${data.action} - ${data.details}`, data.action === 'ERROR' ? 'text-red-400' : 'text-blue-300');
    
    if (data.action === 'REQUEST') {
        currentRequestCounts[data.server_port] = (currentRequestCounts[data.server_port] || 0) + 1;
    }
    
    if (['START', 'STOP', 'STALL', 'RESUME'].includes(data.action)) {
        refreshState();
    }
});

// Client Events
socket.on('client_event', (data) => {
    appendLog(`[CLIENT:${data.client_id}] ${data.action} - ${data.details}`, data.action === 'ERROR' ? 'text-red-400' : 'text-purple-300');
    
    if (['STOP', 'ERROR', 'PONG', 'TIMEOUT'].includes(data.action)) {
        // Refresh periodically on structure changes
        let requireRefresh = ['STOP', 'ERROR'].includes(data.action);
        if(requireRefresh) refreshState();
    }
});

function appendLog(msg, colorClass='text-green-400') {
    const consoleEl = document.getElementById('log-console');
    const timeStr = new Date().toISOString().split('T')[1].split('.')[0];
    const div = document.createElement('div');
    div.className = `whitespace-pre-wrap ${colorClass}`;
    div.innerText = `[${timeStr}] ${msg}`;
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
    
    // Limits
    if (consoleEl.childElementCount > 100) {
        consoleEl.removeChild(consoleEl.firstChild);
    }
}


// UI API calls
async function fetchApi(url, options = {}) {
    const r = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json' }
    });
    if(!r.ok) {
        const body = await r.json().catch(()=>({}));
        appendLog(`[API ERROR] ${body.error || r.statusText}`, 'text-red-500');
    }
    return r.json();
}

async function refreshState() {
    servers = await fetchApi('/api/servers');
    clients = await fetchApi('/api/clients');
    renderServers();
    renderClients();
}

function renderServers() {
    const container = document.getElementById('server-list');
    container.innerHTML = '';
    
    // Sort logic
    servers.sort((a,b) => a.port - b.port).forEach(s => {
        const d = document.createElement('div');
        d.className = 'border border-gray-200 rounded p-3 flex justify-between items-center text-sm';
        
        let statusTag = s.running 
            ? (s.stalled ? '<span class="text-orange-600 font-bold">Stalled</span>' : '<span class="text-green-600 font-bold">Running</span>') 
            : '<span class="text-gray-500 font-bold">Stopped</span>';

        d.innerHTML = `
            <div>
                <strong>Port ${s.port}</strong> <span class="text-gray-500 text-xs">(${s.ip})</span>
                <div class="mt-1">${statusTag}</div>
            </div>
            <div class="flex gap-1 flex-col">
                <div class="flex gap-1 justify-end">
                    ${!s.running ? `<button onclick="cmdServer(${s.port}, 'start')" class="bg-green-100 text-green-700 px-2 py-1 hover:bg-green-200 rounded">Start</button>` : ''}
                    ${s.running && !s.stalled ? `<button onclick="cmdServer(${s.port}, 'stall')" class="bg-orange-100 text-orange-700 px-2 py-1 hover:bg-orange-200 rounded">Stall</button>` : ''}
                    ${s.running && s.stalled ? `<button onclick="cmdServer(${s.port}, 'resume')" class="bg-blue-100 text-blue-700 px-2 py-1 hover:bg-blue-200 rounded">Resume</button>` : ''}
                    ${s.running ? `<button onclick="cmdServer(${s.port}, 'stop')" class="bg-red-100 text-red-700 px-2 py-1 hover:bg-red-200 rounded">Stop</button>` : ''}
                </div>
                <button onclick="cmdServer(${s.port}, 'delete', 'DELETE')" class="text-xs text-red-500 hover:underlinetext-right">Remove</button>
            </div>
        `;
        container.appendChild(d);
    });
}

function renderClients() {
    const container = document.getElementById('client-list');
    container.innerHTML = '';
    
    clients.forEach(c => {
        const d = document.createElement('div');
        d.className = 'border border-gray-200 rounded p-3 flex justify-between items-center text-sm';
        d.innerHTML = `
            <div>
                <strong>${c.id}</strong> <span class="text-xs text-gray-500">Delay: ${c.delay}s</span>
                <div class="mt-1 text-gray-600 font-mono text-xs">Target: ${c.target_ip}:${c.target_port}</div>
            </div>
            <div>
                 <button onclick="cmdClient('${c.id}', 'stop')" class="bg-red-100 text-red-700 px-2 py-1 hover:bg-red-200 rounded">Terminate</button>
            </div>
        `;
        container.appendChild(d);
    });
}

// Actions
window.cmdServer = async (port, action, method='POST') => {
    await fetchApi(`/api/servers/${port}/${action}`, { method });
    setTimeout(refreshState, 200); // give backend a slice to finish
};

window.cmdClient = async (id, action, method='POST') => {
    await fetchApi(`/api/clients/${id}/${action}`, { method });
    setTimeout(refreshState, 200);
}

// Forms
document.getElementById('form-create-server').addEventListener('submit', async (e) => {
    e.preventDefault();
    const port = document.getElementById('srv-port').value;
    await fetchApi('/api/servers/create', {
        method: 'POST',
        body: JSON.stringify({ port })
    });
    document.getElementById('srv-port').value = '';
    refreshState();
});

document.getElementById('form-create-client').addEventListener('submit', async (e) => {
    e.preventDefault();
    const target_ip = document.getElementById('cli-ip').value;
    const target_port = document.getElementById('cli-port').value;
    const delay = document.getElementById('cli-delay').value;
    
    await fetchApi('/api/clients/create', {
        method: 'POST',
        body: JSON.stringify({ target_ip, target_port, delay })
    });
    refreshState();
});

// Initial fetch
refreshState();
