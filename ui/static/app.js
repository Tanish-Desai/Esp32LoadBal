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
        datasets: []
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                title: { display: true, text: 'Time' },
                ticks: { display: false }
            },
            y: {
                title: { display: true, text: 'Requests in Period' },
                min: 0,
                suggestedMax: 10,
            }
        },
        animation: { duration: 0 }
    }
};
const trafficChart = new Chart(ctx, chartCfg);

const ctxTotal = document.getElementById('totalPeriodChart').getContext('2d');
const totalChartCfg = {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Total Period Requests (All)',
                data: [],
                borderColor: '#6366F1',
                tension: 0.2,
                fill: true,
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                title: { display: true, text: 'Time' },
                ticks: { display: false }
            },
            y: {
                title: { display: true, text: 'Requests in Period' },
                min: 0,
                suggestedMax: 10,
            }
        },
        animation: { duration: 0 }
    }
};
const totalPeriodChart = new Chart(ctxTotal, totalChartCfg);

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
const lastNonZeroCounts = {}; // { port: count }
let totalRequestsReceived = 0;
let UPDATE_INTERVAL_MS = parseInt(document.getElementById('chart-refresh')?.value) || 250;
let chartInterval;

function startChartInterval() {
    if (chartInterval) clearInterval(chartInterval);
    chartInterval = setInterval(() => {
        // Tick the chart every UPDATE_INTERVAL_MS
        const now = new Date().toLocaleTimeString();
        trafficChart.data.labels.push(now);
        totalPeriodChart.data.labels.push(now);

        let periodTotal = 0;
        servers.forEach(srv => {
            let dataset = trafficChart.data.datasets.find(d => d.label === `Server ${srv.port}`);
            if (!dataset) {
                const CHART_COLORS = [
                    '#e6194B', // Red
                    '#3cb44b', // Green
                    '#4363d8', // Blue
                    '#f58231', // Orange
                    '#911eb4'  // Purple
                ];
                const colorIndex = trafficChart.data.datasets.length % CHART_COLORS.length;
                dataset = {
                    label: `Server ${srv.port}`,
                    data: [],
                    borderColor: CHART_COLORS[colorIndex],
                    tension: 0.2, // Smooth lines
                    fill: false
                };
                trafficChart.data.datasets.push(dataset);
            }
            const count = currentRequestCounts[srv.port] || 0;
            periodTotal += count;
            
            if (count > 0) {
                lastNonZeroCounts[srv.port] = count;
            }

            // Push the requests received in this period
            dataset.data.push(count);

            // Reset counter
            currentRequestCounts[srv.port] = 0;
        });

        // Update fixed datasets
        const periodTotalDataset = totalPeriodChart.data.datasets.find(d => d.label === 'Total Period Requests (All)');
        if (periodTotalDataset) periodTotalDataset.data.push(periodTotal);

        // Keep last 60 ticks
        if (trafficChart.data.labels.length > 60) {
            trafficChart.data.labels.shift();
            trafficChart.data.datasets.forEach(d => d.data.shift());
            
            totalPeriodChart.data.labels.shift();
            totalPeriodChart.data.datasets.forEach(d => d.data.shift());
        }
        
        trafficChart.update();
        totalPeriodChart.update();
        
        // Update live stats HTML
        const statTotalParams = document.getElementById('stat-total-reqs');
        if (statTotalParams) {
            statTotalParams.innerText = totalRequestsReceived;
        }

        // Render server-specific period stats
        const liveStatsContainer = document.getElementById('live-stats');
        if (liveStatsContainer) {
            liveStatsContainer.innerHTML = '';
            servers.sort((a,b) => a.port - b.port).forEach(srv => {
                const dataset = trafficChart.data.datasets.find(d => d.label === `Server ${srv.port}`);
                const currentVal = dataset ? dataset.data[dataset.data.length - 1] : 0;
                const lastNonZero = lastNonZeroCounts[srv.port] || 0;
                
                const div = document.createElement('div');
                div.className = 'p-3 bg-gray-50 dark:bg-gray-700 rounded text-center border border-gray-200 dark:border-gray-600';
                div.innerHTML = `
                    <div class="font-semibold text-gray-500 dark:text-gray-400">Server ${srv.port}</div>
                    <div class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">${currentVal}</div>
                    <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">Last >0: <span class="font-bold">${lastNonZero}</span></div>
                `;
                liveStatsContainer.appendChild(div);
            });
        }
        
    }, UPDATE_INTERVAL_MS);
}
startChartInterval();

window.addEventListener('DOMContentLoaded', () => {
    const refreshInput = document.getElementById('chart-refresh');
    if (refreshInput) {
        refreshInput.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (val && val >= 100) {
                UPDATE_INTERVAL_MS = val;
                startChartInterval();
            }
        });
    }
});


// Server Events
socket.on('server_event', (data) => {
    // Ex: {server_port, action: 'REQUEST', details, timestamp}
    appendLog(`[SERVER:${data.server_port}] ${data.action} - ${data.details}`, data.action === 'ERROR' ? 'text-red-400' : 'text-blue-300');
    
    if (data.action === 'REQUEST') {
        currentRequestCounts[data.server_port] = (currentRequestCounts[data.server_port] || 0) + 1;
        totalRequestsReceived++;
        const el = document.getElementById('stat-total-reqs');
        if (el) el.innerText = totalRequestsReceived;
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
                <strong class="dark:text-white">Port ${s.port}</strong> <span class="text-gray-500 dark:text-gray-400 text-xs">(${s.ip}, Lag: ${s.latency}%)</span>
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
                <strong class="dark:text-white">${c.id}</strong> <span class="text-xs text-gray-500 dark:text-gray-400">Delay: ${c.delay}s, Timeout: ${c.timeout}s</span>
                <div class="mt-1 text-gray-600 dark:text-gray-400 font-mono text-xs">Target: ${c.target_ip}:${c.target_port}</div>
                <div class="text-xs text-blue-500 font-mono mt-1">Live ID: ${c.current_client_id || 'N/A'}</div>
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
    const latency = document.getElementById('srv-latency').value;
    await fetchApi('/api/servers/create', {
        method: 'POST',
        body: JSON.stringify({ port, latency })
    });
    document.getElementById('srv-port').value = '';
    refreshState();
});

document.getElementById('form-create-client').addEventListener('submit', async (e) => {
    e.preventDefault();
    const target_ip = document.getElementById('cli-ip').value;
    const target_port = document.getElementById('cli-port').value;
    const delay = document.getElementById('cli-delay').value;
    const timeout = document.getElementById('cli-timeout').value;
    
    await fetchApi('/api/clients/create', {
        method: 'POST',
        body: JSON.stringify({ target_ip, target_port, delay, timeout })
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

// Start periodic sync roughly every 1.5s to catch new client IDs smoothly
setInterval(refreshState, 1500);

// Initial fetch
refreshState();
