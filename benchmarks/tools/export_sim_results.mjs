// Run every scenario across all three strategies over multiple seeds and write
// the aggregate into data/project_data.json under simulation_findings.scenario_results.
//
// Multi-seed by default: a single-seed number is an anecdote, and the deck
// should quote a mean with its worst case visible.
import { Simulation } from '../../ui/static/sim-engine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataPath = path.join(root, 'data', 'project_data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const SEEDS = [12345, 999, 4242, 777, 31337, 8080, 22222, 65535];
const KINDS = ['round_robin', 'q_learning', 'ema'];
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const r1 = x => Math.round(x * 10) / 10;

const out = {};
for (const sc of data.scenarios) {
  const perStrategy = {};
  for (const kind of KINDS) {
    const runs = SEEDS.map(seed => new Simulation(sc.sim_config, kind, seed).run());
    perStrategy[kind] = {
      goodput_pct: r1(mean(runs.map(r => r.goodputPct))),
      goodput_worst_pct: r1(Math.min(...runs.map(r => r.goodputPct))),
      mean_latency_ms: Math.round(mean(runs.map(r => r.meanLatency))),
      p95_latency_ms: Math.round(mean(runs.map(r => r.p95))),
      served: Math.round(mean(runs.map(r => r.completed))),
      timeouts: r1(mean(runs.map(r => r.timeouts))),
      rejected: r1(mean(runs.map(r => r.rejected))),
      distribution_pct: runs[0].distribution.map((d, i) => ({
        name: d.name,
        share_pct: r1(mean(runs.map(r => r.distribution[i].sharePct))),
      })),
    };
  }
  const ql = perStrategy.q_learning, rr = perStrategy.round_robin, em = perStrategy.ema;
  const winner = [['q_learning', ql], ['round_robin', rr], ['ema', em]]
    .sort((a, b) => b[1].goodput_pct - a[1].goodput_pct)[0][0];

  out[sc.id] = {
    name: sc.name,
    seeds: SEEDS.length,
    strategies: perStrategy,
    ql_vs_rr_goodput_pts: r1(ql.goodput_pct - rr.goodput_pct),
    ql_vs_ema_goodput_pts: r1(ql.goodput_pct - em.goodput_pct),
    best_strategy: winner,
    honest_note: winner === 'q_learning'
      ? 'Q-learning wins this scenario on goodput.'
      : `Q-learning does NOT win this scenario - ${winner} does. Presented as-is.`,
  };
  console.log(`${sc.name}: best=${winner}  QL=${ql.goodput_pct}%  RR=${rr.goodput_pct}%  EMA=${em.goodput_pct}%`);
}

data.simulation_findings.scenario_results = out;
data.simulation_findings.seeds_used = SEEDS;
data.simulation_findings.generated_at = new Date().toISOString();
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log('\nWritten to data/project_data.json');
