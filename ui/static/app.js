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

const ctxAvg = document.getElementById('avgResponseTimeChart').getContext('2d');
const avgChartCfg = {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Average Response Time (ms)',
            data: [],
            borderColor: '#F59E0B',
            tension: 0.2,
            fill: true,
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
        }]
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
                title: { display: true, text: 'Latency (ms)' },
                min: 0,
            }
        },
        animation: { duration: 0 }
    }
};
const avgResponseTimeChart = new Chart(ctxAvg, avgChartCfg);

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
let periodTotalResponseTime = 0;
let periodPongCount = 0;
let UPDATE_INTERVAL_MS = parseInt(document.getElementById('chart-refresh')?.value) || 250;
let chartInterval;

function startChartInterval() {
    if (chartInterval) clearInterval(chartInterval);
    chartInterval = setInterval(() => {
        // Tick the chart every UPDATE_INTERVAL_MS
        const now = new Date().toLocaleTimeString();
        trafficChart.data.labels.push(now);
        totalPeriodChart.data.labels.push(now);
        avgResponseTimeChart.data.labels.push(now);

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

        const avgDataset = avgResponseTimeChart.data.datasets[0];
        const avgResp = periodPongCount > 0 ? (periodTotalResponseTime / periodPongCount) : 0;
        
        if (periodPongCount > 0) {
            avgDataset.data.push(avgResp);
        } else {
            avgDataset.data.push(avgDataset.data.length > 0 ? avgDataset.data[avgDataset.data.length - 1] : 0);
        }
        
        periodTotalResponseTime = 0;
        periodPongCount = 0;

        // Keep last 60 ticks
        if (trafficChart.data.labels.length > 60) {
            trafficChart.data.labels.shift();
            trafficChart.data.datasets.forEach(d => d.data.shift());
            
            totalPeriodChart.data.labels.shift();
            totalPeriodChart.data.datasets.forEach(d => d.data.shift());

            avgResponseTimeChart.data.labels.shift();
            avgDataset.data.shift();
        }
        
        trafficChart.update();
        totalPeriodChart.update();
        avgResponseTimeChart.update();
        
        // Update live stats HTML
        const statTotalParams = document.getElementById('stat-total-reqs');
        if (statTotalParams) {
            statTotalParams.innerText = totalRequestsReceived;
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
    
    if (['START', 'STOP', 'LATENCY_UPDATE'].includes(data.action)) {
        refreshState();
    }
});

// Client Events
socket.on('client_event', (data) => {
    appendLog(`[CLIENT:${data.client_id}] ${data.action} - ${data.details}`, data.action === 'ERROR' ? 'text-red-400' : 'text-purple-300');
    
    if (data.action === 'PONG' && data.response_time !== undefined) {
        periodTotalResponseTime += data.response_time;
        periodPongCount += 1;
    }

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
            ? '<span class="text-green-600 dark:text-green-500 font-bold">Running</span>' 
            : '<span class="text-gray-500 dark:text-gray-400 font-bold">Stopped</span>';

        d.innerHTML = `
            <div>
                <strong class="dark:text-white">Port ${s.port}</strong> <span class="text-gray-500 dark:text-gray-400 text-xs">(${s.ip})</span>
                <div class="mt-1">${statusTag}</div>
            </div>
            <div class="flex gap-2 flex-col items-end">
                <div class="flex items-center gap-2">
                    <label class="text-xs text-gray-500 dark:text-gray-400">Latency %</label>
                    <input type="number" min="0" max="100" value="${s.latency}" onchange="updateLatency(${s.port}, this.value)" class="w-16 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-1 py-1 text-xs text-right">
                </div>
                <div class="flex gap-1 justify-end mt-1">
                    ${!s.running ? `<button onclick="cmdServer(${s.port}, 'start')" class="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200 px-2 py-1 hover:bg-green-200 dark:hover:bg-green-800 rounded">Start</button>` : ''}
                    ${s.running ? `<button onclick="cmdServer(${s.port}, 'stop')" class="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200 px-2 py-1 hover:bg-red-200 dark:hover:bg-red-800 rounded">Stop</button>` : ''}
                </div>
                <button onclick="cmdServer(${s.port}, 'delete', 'DELETE')" class="text-xs text-red-500 hover:underline text-right mt-1">Remove</button>
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

window.updateLatency = async (port, latencyValue) => {
    await fetchApi(`/api/servers/${port}/latency`, {
        method: 'POST',
        body: JSON.stringify({ latency: latencyValue })
    });
    setTimeout(refreshState, 200);
};

window.cmdClient = async (id, action, method='POST') => {
    await fetchApi(`/api/clients/${id}/${action}`, { method });
    setTimeout(refreshState, 200);
};

window.cmdKillAllClients = async () => {
    await fetchApi(`/api/clients/stop_all`, { method: 'POST' });
    setTimeout(refreshState, 200);
};

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
