// When does Q-learning actually help?
//
// Thesis: a learning balancer needs something to learn. If every backend is
// equally fast, there is no signal in the reward, the argmax picks a winner
// essentially at random, and then self-reinforces - it keeps choosing the
// backend it already chose, concentrating load ("herding"). If backends DIFFER,
// the reward carries real information and learning pays off.
//
// This experiment holds everything constant except the latency spread between
// two backends, and measures goodput for each strategy.
import { Simulation } from '../../ui/static/sim-engine.js';

const SEEDS = [12345, 999, 4242, 777, 31337, 8080, 22222, 65535];
const KINDS = ['round_robin', 'q_learning', 'ema'];
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

// Backend A fixed at 60ms; backend B swept from identical to 10x slower.
const SPREADS = [1.0, 1.5, 2.0, 3.0, 5.0, 8.0, 12.0];

console.log('Two backends, 6 clients, no degradation events.');
console.log('Backend A = 60ms. Backend B = 60ms x spread.\n');
console.log('spread   B latency      RR       QL      EMA    QL-RR');
console.log('-'.repeat(56));

const rows = [];
for (const spread of SPREADS) {
  const cfg = {
    backends: 2,
    backend_names: ['A', 'B'],
    base_latency_ms: [60, Math.round(60 * spread)],
    client_count: 6,
    request_interval_ms: 300,
    duration_ticks: 240,
    events: [],
  };
  const res = {};
  for (const kind of KINDS) {
    res[kind] = mean(SEEDS.map(seed => new Simulation(cfg, kind, seed).run().goodputPct));
  }
  const delta = res.q_learning - res.round_robin;
  rows.push({ spread, ...res, delta });
  console.log(
    String(spread + 'x').padEnd(9) +
    String(Math.round(60 * spread) + 'ms').padEnd(12) +
    String(res.round_robin.toFixed(1)).padStart(6) +
    String(res.q_learning.toFixed(1)).padStart(9) +
    String(res.ema.toFixed(1)).padStart(9) +
    String((delta >= 0 ? '+' : '') + delta.toFixed(1)).padStart(9)
  );
}

console.log('\nReading:');
const crossover = rows.find(r => r.delta > 2);
if (crossover) {
  console.log(`  Q-learning starts clearly beating Round Robin at about ${crossover.spread}x spread.`);
} else {
  console.log('  Q-learning never clearly beats Round Robin in this sweep.');
}
const flat = rows[0];
console.log(`  At 1.0x (identical backends) Q-learning is ${flat.delta >= 0 ? 'ahead' : 'behind'} by ${Math.abs(flat.delta).toFixed(1)} pts` +
            ' - with no difference to learn, greedy selection just concentrates load.');
