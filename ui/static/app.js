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
const UPDATE_INTERVAL_MS = 250; 
setInterval(() => {
    // Tick the chart every 250ms
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
        // Multiply by (1000 / UPDATE_INTERVAL_MS) to approximate Requests / Sec
        const factor = 1000 / UPDATE_INTERVAL_MS;
        dataset.data.push((currentRequestCounts[srv.port] || 0) * factor);
        // Reset counter
        currentRequestCounts[srv.port] = 0;
    });

    // Keep last 60 ticks
    if (trafficChart.data.labels.length > 60) {
        trafficChart.data.labels.shift();
        trafficChart.data.datasets.forEach(d => d.data.shift());
    }
    
    trafficChart.update();
}, UPDATE_INTERVAL_MS);


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
        d.className = 'border border-gray-200 dark:border-gray-700 rounded p-3 flex justify-between items-center text-sm bg-white dark:bg-gray-800';
        
        let statusTag = s.running 
            ? (s.stalled ? '<span class="text-orange-600 dark:text-orange-500 font-bold">Stalled</span>' : '<span class="text-green-600 dark:text-green-500 font-bold">Running</span>') 
            : '<span class="text-gray-500 dark:text-gray-400 font-bold">Stopped</span>';

        d.innerHTML = `
            <div>
                <strong class="dark:text-white">Port ${s.port}</strong> <span class="text-gray-500 dark:text-gray-400 text-xs">(${s.ip})</span>
                <div class="mt-1">${statusTag}</div>
            </div>
            <div class="flex gap-1 flex-col">
                <div class="flex gap-1 justify-end">
                    ${!s.running ? `<button onclick="cmdServer(${s.port}, 'start')" class="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200 px-2 py-1 hover:bg-green-200 dark:hover:bg-green-800 rounded">Start</button>` : ''}
                    ${s.running && !s.stalled ? `<button onclick="cmdServer(${s.port}, 'stall')" class="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200 px-2 py-1 hover:bg-orange-200 dark:hover:bg-orange-800 rounded">Stall</button>` : ''}
                    ${s.running && s.stalled ? `<button onclick="cmdServer(${s.port}, 'resume')" class="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 px-2 py-1 hover:bg-blue-200 dark:hover:bg-blue-800 rounded">Resume</button>` : ''}
                    ${s.running ? `<button onclick="cmdServer(${s.port}, 'stop')" class="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200 px-2 py-1 hover:bg-red-200 dark:hover:bg-red-800 rounded">Stop</button>` : ''}
                </div>
                <button onclick="cmdServer(${s.port}, 'delete', 'DELETE')" class="text-xs text-red-500 hover:underline text-right">Remove</button>
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
        d.className = 'border border-gray-200 dark:border-gray-700 rounded p-3 flex justify-between items-center text-sm bg-white dark:bg-gray-800';
        d.innerHTML = `
            <div>
                <strong class="dark:text-white">${c.id}</strong> <span class="text-xs text-gray-500 dark:text-gray-400">Delay: ${c.delay}s</span>
                <div class="mt-1 text-gray-600 dark:text-gray-400 font-mono text-xs">Target: ${c.target_ip}:${c.target_port}</div>
            </div>
            <div>
                 <button onclick="cmdClient('${c.id}', 'stop')" class="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200 px-2 py-1 hover:bg-red-200 dark:hover:bg-red-800 rounded">Terminate</button>
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

// Dark mode toggle logic
const themeToggleBtn = document.getElementById('theme-toggle');
const themeToggleDarkIcon = document.getElementById('theme-toggle-dark-icon');
const themeToggleLightIcon = document.getElementById('theme-toggle-light-icon');

function updateThemeIcons() {
    if (document.documentElement.classList.contains('dark')) {
        themeToggleLightIcon.classList.remove('hidden');
        themeToggleDarkIcon.classList.add('hidden');
    } else {
        themeToggleLightIcon.classList.add('hidden');
        themeToggleDarkIcon.classList.remove('hidden');
    }
}

// Initial theme setup
if (localStorage.getItem('color-theme') === 'dark' || (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
} else {
    document.documentElement.classList.remove('dark');
}
if(themeToggleBtn) {
    updateThemeIcons();
    themeToggleBtn.addEventListener('click', function() {
        if (localStorage.getItem('color-theme')) {
            if (localStorage.getItem('color-theme') === 'light') {
                document.documentElement.classList.add('dark');
                localStorage.setItem('color-theme', 'dark');
            } else {
                document.documentElement.classList.remove('dark');
                localStorage.setItem('color-theme', 'light');
            }
        } else {
            if (document.documentElement.classList.contains('dark')) {
                document.documentElement.classList.remove('dark');
                localStorage.setItem('color-theme', 'light');
            } else {
                document.documentElement.classList.add('dark');
                localStorage.setItem('color-theme', 'dark');
            }
        }
        updateThemeIcons();
    });
}

// Initial fetch
refreshState();
