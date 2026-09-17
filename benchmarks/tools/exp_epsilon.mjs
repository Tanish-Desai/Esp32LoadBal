// Sweep min_epsilon across every scenario and several seeds.
//
// Motivation: the firmware ships min_epsilon = 0.05. That is a sensible default
// for a STATIONARY problem, where the best backend never changes. Our scenarios
// are deliberately non-stationary - backends degrade and recover mid-run - and a
// 5% exploration floor may be too little to notice.
//
// Multiple seeds matter. A result that only holds for seed 12345 is an anecdote.
import { Simulation } from '../../ui/static/sim-engine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'project_data.json'), 'utf8'));

const SEEDS = [12345, 999, 4242, 777, 31337, 8080, 22222, 65535];
const CANDIDATES = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30];

function meanOf(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }

console.log(`Sweeping min_epsilon over ${SEEDS.length} seeds per cell.\n`);

const perCandidate = {};
for (const sc of data.scenarios) {
  console.log(`=== ${sc.name} ===`);
  console.log('min_eps   mean goodput   worst seed   mean latency');
  for (const cand of CANDIDATES) {
    const goodputs = [], latencies = [];
    for (const seed of SEEDS) {
      const sim = new Simulation(sc.sim_config, 'q_learning', seed);
      sim.strategy.minEpsilon = cand;
      const r = sim.run();
      goodputs.push(r.goodputPct);
      latencies.push(r.meanLatency);
    }
    const mg = meanOf(goodputs), worst = Math.min(...goodputs);
    (perCandidate[cand] ||= []).push(mg);
    console.log(
      String(cand).padEnd(10) +
      String(mg.toFixed(1) + '%').padStart(13) +
      String(worst.toFixed(1) + '%').padStart(13) +
      String(Math.round(meanOf(latencies)) + 'ms').padStart(15)
    );
  }
  console.log('');
}

console.log('=== Across all scenarios ===');
console.log('min_eps   mean goodput   worst scenario');
let best = null;
for (const cand of CANDIDATES) {
  const arr = perCandidate[cand];
  const mg = meanOf(arr), worst = Math.min(...arr);
  console.log(String(cand).padEnd(10) + String(mg.toFixed(1)+'%').padStart(13) + String(worst.toFixed(1)+'%').padStart(17));
  // Choose on the WORST scenario, not the average. A balancer is judged by its
  // bad day, and an average hides the one deployment where it fails.
  if (!best || worst > best.worst) best = { cand, mg, worst };
}
console.log(`\nBest by worst-case scenario: min_epsilon = ${best.cand} (worst ${best.worst.toFixed(1)}%)`);
