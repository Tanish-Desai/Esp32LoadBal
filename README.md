# ESP32 RL Load Balancer

Reinforcement-learning traffic distribution on a $4 microcontroller. The ESP32
acts as a Layer-7 reverse proxy between clients and backend servers, choosing
which backend to forward each request to using Q-learning, EMA response-time
tracking, or round-robin.

Built for an embedded-systems course. The project demonstrates that on-device RL
can improve goodput over static strategies when backend performance diverges --
and documents honestly where it cannot.


## Architecture

```
Client  --->  ESP32 (reverse proxy + RL agent)  --->  Backend servers
              WiFi, bare metal, 520 KB RAM              Python, threaded
```

- The ESP32 is the gateway. To clients it looks like the server; to servers it
  looks like a client.
- Layer 7: the firmware inspects packet content (termination strings), not just
  headers.
- Hard concurrency ceiling: 16 sockets, 1 listener, 2 per session = 7 max
  concurrent proxy sessions.


## Load Balancing Strategies

All three strategies ship in the same firmware binary. The operator picks one
at boot over the serial monitor.

**Q-Learning** -- State is the number of active proxy sessions (0-7). Action is
the backend index. Reward is `1000 / (duration_ms + 1)` on success, `-50` on
timeout. The Bellman update runs after every completed session with alpha 0.3,
gamma 0.5, epsilon decaying from 1.0 to 0.05 at 0.95 per update.

**EMA Response Time** -- Maintains an exponential moving average of the reward
per backend (alpha 0.3, optimistic initialisation at 1000). Always picks the
backend with the highest EMA. Simpler than Q-learning, no state awareness, but
effective when backends are stable.

**Round Robin** -- Cycles through backends in order. Stateless by design. The
correct choice when backends are interchangeable.


## Key Finding

Q-learning's advantage is conditional on backend heterogeneity. Sweeping the
latency spread between two backends over 8 seeds:

| Spread | Round Robin | Q-Learning | EMA   | QL - RR |
|--------|-------------|------------|-------|---------|
| 1x     | 100.0%      | 100.0%     | 100.0%| +0.0    |
| 3x     | 100.0%      | 100.0%     | 100.0%| +0.0    |
| 8x     | 71.3%       | 99.1%      | 94.8% | +27.8   |
| 12x    | 49.8%       | 93.7%      | 87.2% | +44.0   |

Below about 5x spread every strategy saturates -- round robin is the correct
engineering choice because it is free. Past 8x the picture inverts: round robin
collapses while Q-learning holds above 93%.

Reproduce: `node benchmarks/tools/exp_heterogeneity.mjs`


## Known Weakness

In the retail scenario (two nearly identical backends, degradation after
epsilon has decayed to its floor), Q-learning underperforms both round robin
and EMA. The root cause is diagnosed in `data/project_data.json` under
`simulation_findings.known_weakness` and presented on the scenarios page without
being explained away. A load balancer that is only tested where it wins has not
been tested.


## Repository Layout

```
esp32/                   Firmware (PlatformIO, C++)
  MyFirstESP32/src/        main.cpp, strategy selection, proxy loop
  lib/LoadBalancerAlgorithms/  QLearning, EmaResponseTime, RoundRobin

server-client/           Python backend and mock client
  server.py                Threaded TCP server with configurable latency
  client.py                Mock client for live dashboard demos

ui/                      Flask web application
  app.py                   Dashboard + scenario routes + project-data API
  static/app.js            Live dashboard JS (Chart.js, Socket.IO)
  static/sim-engine.js     Faithful JS port of firmware algorithms
  templates/index.html     Live dashboard
  templates/scenarios.html Scenario simulation page (runs in browser)

benchmarks/              Measurement and analysis tooling
  run_benchmark.py         Hardware benchmark harness (drives real ESP32)
  tools/verify_sim.mjs     Runs all scenarios, reports goodput, flags losses
  tools/exp_heterogeneity.mjs  Sweeps latency spread over 8 seeds
  tools/exp_epsilon.mjs    Sweeps min-epsilon over 8 seeds
  tools/export_sim_results.mjs Writes multi-seed aggregates to project_data.json

data/
  project_data.json        Single source of truth for all figures

presentation/
  build_deck.py            Generates the .pptx from project_data.json
  ESP32_RL_Load_Balancer.pptx  Generated deck (15 slides)

misc_tools/              Windows firewall utility
```


## Setup

### Prerequisites

- Python 3.9+
- Node.js 18+ (for simulation tooling only; not needed at runtime)
- PlatformIO (for firmware compilation)

### Install Python dependencies

```
pip install -r requirements.txt
```

### Start the dashboard

```
python ui/app.py
```

Open `http://localhost:5000` for the live dashboard. The scenario simulation page
is at `http://localhost:5000/scenarios`.

### Flash the firmware

1. Open the `esp32/` directory in PlatformIO.
2. Compile and upload to your ESP32.
3. Open the serial monitor at 115200 baud.

### Connect via captive portal

If the ESP32 has no saved credentials, it broadcasts an AP named
"ESP32 Web Portal". Connect to it, enter your WiFi SSID, password, and laptop
IP in the captive portal (or navigate to `192.168.4.1`).

### Boot configuration (serial monitor)

1. Laptop IP -- press Enter to keep the saved value or type a new one.
2. Backends -- number of backend servers spawned in the UI (1-5).
3. Strategy -- 1 for Round Robin, 2 for Q-Learning, 3 for EMA.

### Run the hardware benchmark

The benchmark harness drives real traffic through a real ESP32. Run it once per
strategy, rebooting the ESP32 and selecting the next strategy each time:

```
python benchmarks/run_benchmark.py --esp32-ip <IP> --strategy round_robin
python benchmarks/run_benchmark.py --esp32-ip <IP> --strategy q_learning
python benchmarks/run_benchmark.py --esp32-ip <IP> --strategy ema
```

Results merge into `data/project_data.json`. After all three, rebuild the deck:

```
python presentation/build_deck.py
```

### Simulate traffic (no hardware)

The scenario page at `/scenarios` runs the simulation entirely in the browser
against a line-for-line JS port of the firmware algorithms. No ESP32 or backend
servers needed. Change the seed, replay, watch Q-learning explore then exploit --
and watch it fail on the retail scenario.


## Data Pipeline

Every downstream number reads from `data/project_data.json`. The file carries a
status per value: `measured` (from the benchmark harness), `cited` (from a
published source with URL), `modelled` (derived from specs), or
`pending_measurement` (placeholder). Nothing is presented as fact until its
status is `measured` or `cited`.

```
ESP32 hardware run
      |
      v
benchmarks/run_benchmark.py  -->  data/project_data.json
                                        |
                      +-----------------+-----------------+
                      |                                   |
              ui/templates/scenarios.html      presentation/build_deck.py
              (browser simulation)             (.pptx generation)
```


## Troubleshooting

**ESP32 cannot reach the Python backend servers**

Windows Firewall blocks incoming connections on ports 8080-8084 when the WiFi
network profile is set to Public. Change it to Private in Windows settings, or
run `misc_tools/disable_priv_firewall.ps1` (right-click, Run with PowerShell).
