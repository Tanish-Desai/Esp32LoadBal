"""
Benchmark harness for the ESP32 RL Load Balancer.

Drives real traffic through a real ESP32 and records what actually happened,
then writes the numbers into data/project_data.json so the presentation and the
scenario simulations both read measured values instead of guesses.

The ESP32 picks its strategy at boot over serial, so one run measures one
strategy. Run it three times, rebooting the ESP32 and selecting a different
strategy each time, and the harness accumulates all three into the same file.

Usage
-----
    # 1. Boot the ESP32, pick Round Robin at the serial prompt, then:
    python benchmarks/run_benchmark.py --esp32-ip 192.168.1.50 --strategy round_robin

    # 2. Reboot the ESP32, pick Q-Learning, then:
    python benchmarks/run_benchmark.py --esp32-ip 192.168.1.50 --strategy q_learning

    # 3. Reboot the ESP32, pick EMA, then:
    python benchmarks/run_benchmark.py --esp32-ip 192.168.1.50 --strategy ema

Every run uses the same backend latency profile so the three strategies are
compared on identical conditions. That is the whole point - change one variable.
"""

import argparse
import json
import os
import statistics
import sys
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'server-client')))
from server import ManagedServer  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_FILE = os.path.join(REPO_ROOT, 'data', 'project_data.json')
RESULTS_DIR = os.path.join(os.path.dirname(__file__), 'results')

STRATEGY_KEYS = ('round_robin', 'q_learning', 'ema')

# The default profile deliberately makes one backend slow. A load balancer that
# cannot tell the difference between backends has nothing to prove on a uniform
# profile - every strategy looks identical and the comparison is meaningless.
DEFAULT_PROFILE = [
    {'port': 8080, 'latency_pct': 0,  'label': 'healthy'},
    {'port': 8081, 'latency_pct': 45, 'label': 'degraded'},
    {'port': 8082, 'latency_pct': 5,  'label': 'healthy'},
]


class RequestRecorder:
    """Thread-safe collector for per-request outcomes."""

    def __init__(self):
        self.lock = threading.Lock()
        self.latencies_ms = []
        self.timeouts = 0
        self.errors = 0
        self.per_backend = defaultdict(int)
        self.timeline = []  # (elapsed_s, latency_ms, backend_port) for convergence analysis

    def record_success(self, latency_ms, elapsed_s):
        with self.lock:
            self.latencies_ms.append(latency_ms)
            self.timeline.append({'t': round(elapsed_s, 3), 'latency_ms': round(latency_ms, 2)})

    def record_timeout(self):
        with self.lock:
            self.timeouts += 1

    def record_error(self):
        with self.lock:
            self.errors += 1

    def record_backend_hit(self, port):
        with self.lock:
            self.per_backend[port] += 1


class BenchClient(threading.Thread):
    """Fires requests at the ESP32 in a loop until told to stop.

    Deliberately kept separate from MockClient in server-client/client.py:
    that one is built for live UI demos and logs to websockets. This one is
    built for measurement and does nothing but time requests.
    """

    def __init__(self, target_ip, target_port, client_id, recorder, interval_s, timeout_s, t0):
        super().__init__()
        self.target_ip = target_ip
        self.target_port = target_port
        self.client_id = client_id
        self.recorder = recorder
        self.interval_s = interval_s
        self.timeout_s = timeout_s
        self.t0 = t0
        self.running = True
        self.daemon = True

    def run(self):
        import socket
        seq = 0
        while self.running:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(self.timeout_s)
            start = time.time()
            try:
                sock.connect((self.target_ip, self.target_port))
                msg = (f"GET /bench/{self.client_id}/{seq} HTTP/1.1\r\n"
                       f"Host: {self.target_ip}\r\n\r\n")
                sock.sendall(msg.encode('utf-8'))
                response = sock.recv(1024)
                end = time.time()
                if response:
                    self.recorder.record_success((end - start) * 1000.0, end - self.t0)
                else:
                    self.recorder.record_error()
            except socket.timeout:
                self.recorder.record_timeout()
            except Exception:
                self.recorder.record_error()
            finally:
                try:
                    sock.close()
                except Exception:
                    pass
            seq += 1
            if self.running:
                time.sleep(self.interval_s)

    def stop(self):
        self.running = False


def percentile(sorted_values, pct):
    """Nearest-rank percentile. No numpy dependency for a 200-line script."""
    if not sorted_values:
        return None
    k = max(0, min(len(sorted_values) - 1, int(round(pct / 100.0 * len(sorted_values) + 0.5)) - 1))
    return sorted_values[k]


def estimate_convergence(timeline, window=20, tolerance_pct=15.0):
    """Find the request index after which mean latency stays near its final value.

    Answers the question a viva examiner will ask about Q-learning: how long
    does it take to learn? Returns the request number, or None if it never
    settles within the run.
    """
    if len(timeline) < window * 3:
        return None
    latencies = [p['latency_ms'] for p in timeline]
    final_mean = statistics.mean(latencies[-window:])
    if final_mean <= 0:
        return None
    threshold = final_mean * (1 + tolerance_pct / 100.0)
    for i in range(len(latencies) - window):
        if all(statistics.mean(latencies[j:j + window]) <= threshold
               for j in range(i, len(latencies) - window, window)):
            return i + window
    return None


def run_one(args):
    profile = DEFAULT_PROFILE[:args.backends]
    recorder = RequestRecorder()

    def server_event(evt):
        if evt.get('action') == 'REQUEST':
            recorder.record_backend_hit(evt['server_port'])

    print(f"\n{'=' * 64}")
    print(f"  Benchmark: {args.strategy}")
    print(f"{'=' * 64}")
    print(f"  ESP32 target : {args.esp32_ip}:{args.esp32_port}")
    print(f"  Backends     : {len(profile)}")
    for b in profile:
        print(f"      port {b['port']}  latency {b['latency_pct']}%  ({b['label']})")
    print(f"  Clients      : {args.clients}")
    print(f"  Duration     : {args.duration}s")
    print(f"{'=' * 64}\n")

    print("Starting backends...")
    servers = []
    for b in profile:
        srv = ManagedServer('0.0.0.0', b['port'], event_callback=server_event, latency=b['latency_pct'])
        srv.start()
        servers.append(srv)
    time.sleep(1.0)

    running = [s for s in servers if s.running]
    if len(running) != len(profile):
        print("ERROR: not all backends bound their ports. Check for port conflicts "
              "or a firewall profile set to Public (see misc_tools/disable_priv_firewall.ps1).")
        for s in servers:
            s.stop()
        return None

    print(f"All {len(running)} backends listening.\n")
    print(f"Confirm the ESP32 is booted, connected, and set to '{args.strategy}'.")
    input("Press Enter to begin the run... ")

    t0 = time.time()
    clients = [
        BenchClient(args.esp32_ip, args.esp32_port, f"b{i}", recorder,
                    args.interval, args.timeout, t0)
        for i in range(args.clients)
    ]
    for c in clients:
        c.start()

    try:
        while time.time() - t0 < args.duration:
            elapsed = time.time() - t0
            with recorder.lock:
                done = len(recorder.latencies_ms)
                to = recorder.timeouts
            print(f"\r  {elapsed:5.1f}s / {args.duration}s   "
                  f"ok={done:<5} timeouts={to:<4}", end='', flush=True)
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n  Interrupted - using data collected so far.")

    print("\n\nStopping clients...")
    for c in clients:
        c.stop()
    for c in clients:
        c.join(timeout=args.timeout + 1)

    actual_duration = time.time() - t0

    print("Stopping backends...")
    for s in servers:
        s.stop()

    lat = sorted(recorder.latencies_ms)
    total_attempts = len(lat) + recorder.timeouts + recorder.errors

    if not lat:
        print("\nERROR: zero successful requests. The ESP32 is not reachable, or it "
              "cannot reach this machine's backends. Check both directions.")
        return None

    result = {
        'total_requests': len(lat),
        'total_attempts': total_attempts,
        'mean_latency_ms': round(statistics.mean(lat), 2),
        'p50_latency_ms': round(percentile(lat, 50), 2),
        'p95_latency_ms': round(percentile(lat, 95), 2),
        'p99_latency_ms': round(percentile(lat, 99), 2),
        'min_latency_ms': round(lat[0], 2),
        'max_latency_ms': round(lat[-1], 2),
        'stdev_latency_ms': round(statistics.stdev(lat), 2) if len(lat) > 1 else 0.0,
        'timeouts': recorder.timeouts,
        'errors': recorder.errors,
        'timeout_rate_pct': round(100.0 * recorder.timeouts / total_attempts, 2) if total_attempts else 0.0,
        'throughput_rps': round(len(lat) / actual_duration, 2),
        'distribution': {str(k): v for k, v in sorted(recorder.per_backend.items())},
        'backend_profile': profile,
        'run_duration_s': round(actual_duration, 1),
        'client_count': args.clients,
        'status': 'measured',
    }

    if args.strategy == 'q_learning':
        result['convergence_requests'] = estimate_convergence(recorder.timeline)

    if args.save_timeline:
        result['timeline'] = recorder.timeline

    return result


def print_summary(strategy, r):
    print(f"\n{'=' * 64}")
    print(f"  RESULTS: {strategy}")
    print(f"{'=' * 64}")
    print(f"  Successful requests : {r['total_requests']}")
    print(f"  Throughput          : {r['throughput_rps']} req/s")
    print(f"  Mean latency        : {r['mean_latency_ms']} ms")
    print(f"  p50 / p95 / p99     : {r['p50_latency_ms']} / {r['p95_latency_ms']} / {r['p99_latency_ms']} ms")
    print(f"  Timeouts            : {r['timeouts']} ({r['timeout_rate_pct']}%)")
    print(f"  Distribution        :")
    total_hits = sum(r['distribution'].values()) or 1
    for port, count in r['distribution'].items():
        label = next((b['label'] for b in r['backend_profile'] if str(b['port']) == port), '?')
        pct = 100.0 * count / total_hits
        bar = '#' * int(pct / 2)
        print(f"      {port} ({label:>8}) {count:>5}  {pct:5.1f}%  {bar}")
    if r.get('convergence_requests') is not None:
        print(f"  Converged after     : {r['convergence_requests']} requests")
    print(f"{'=' * 64}\n")


def merge_into_data_file(strategy, result, args):
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    mr = data['measured_results']
    mr['strategies'][strategy] = result
    mr['run_timestamp'] = datetime.now(timezone.utc).isoformat()
    mr['config'] = {
        'backends': args.backends,
        'clients': args.clients,
        'duration_s': args.duration,
        'request_interval_s': args.interval,
        'client_timeout_s': args.timeout,
        'latency_profile': DEFAULT_PROFILE[:args.backends],
        'esp32_target': f"{args.esp32_ip}:{args.esp32_port}",
    }

    measured = [k for k in STRATEGY_KEYS
                if mr['strategies'].get(k, {}).get('status') == 'measured']
    mr['status'] = 'measured' if len(measured) == len(STRATEGY_KEYS) else 'partial'
    mr['strategies_measured'] = measured

    data['meta']['last_benchmark_run'] = mr['run_timestamp']

    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

    print(f"Merged into {os.path.relpath(DATA_FILE, REPO_ROOT)}")
    missing = [k for k in STRATEGY_KEYS if k not in measured]
    if missing:
        print(f"Still to measure: {', '.join(missing)}")
        print("Reboot the ESP32, select the next strategy, and run this again.")
    else:
        print("All three strategies measured. The deck will now build on real data:")
        print("    python presentation/build_deck.py")


def main():
    p = argparse.ArgumentParser(
        description='Measure real ESP32 load balancer performance.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__)
    p.add_argument('--esp32-ip', required=True, help='IP the ESP32 printed on its serial monitor')
    p.add_argument('--esp32-port', type=int, default=80)
    p.add_argument('--strategy', required=True, choices=STRATEGY_KEYS,
                   help='Which strategy the ESP32 is currently booted with')
    p.add_argument('--backends', type=int, default=3, choices=[1, 2, 3],
                   help='How many backends to spawn (must match the ESP32 serial prompt)')
    p.add_argument('--clients', type=int, default=5,
                   help='Concurrent clients. Max 7 - the ESP32 socket ceiling.')
    p.add_argument('--duration', type=int, default=120, help='Run length in seconds')
    p.add_argument('--interval', type=float, default=0.3, help='Per-client delay between requests')
    p.add_argument('--timeout', type=float, default=2.0, help='Client socket timeout')
    p.add_argument('--save-timeline', action='store_true',
                   help='Store every request in the results file (large, but lets you plot convergence)')
    p.add_argument('--dry-run', action='store_true',
                   help='Print the plan and exit without touching the network')
    args = p.parse_args()

    if args.clients > 7:
        p.error('The ESP32 supports at most 7 concurrent sessions. '
                'Requesting more measures rejection behaviour, not balancing.')

    if args.dry_run:
        print(json.dumps({
            'strategy': args.strategy,
            'target': f'{args.esp32_ip}:{args.esp32_port}',
            'backends': DEFAULT_PROFILE[:args.backends],
            'clients': args.clients,
            'duration_s': args.duration,
        }, indent=2))
        return

    os.makedirs(RESULTS_DIR, exist_ok=True)
    result = run_one(args)
    if result is None:
        sys.exit(1)

    print_summary(args.strategy, result)

    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    raw_path = os.path.join(RESULTS_DIR, f'{args.strategy}_{stamp}.json')
    with open(raw_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2)
    print(f"Raw result: {os.path.relpath(raw_path, REPO_ROOT)}")

    merge_into_data_file(args.strategy, result, args)


if __name__ == '__main__':
    main()
