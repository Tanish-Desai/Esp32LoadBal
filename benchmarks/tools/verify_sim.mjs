// Sanity check the simulation engine across every scenario and strategy.
//
// The metric that matters is GOODPUT - the share of offered requests that got a
// real answer. Mean latency alone is survivorship-biased: a strategy that drops
// or refuses its slow requests posts a great average precisely because the bad
// requests are missing from it.
import { runComparison } from '../../ui/static/sim-engine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'project_data.json'), 'utf8'));
const KINDS = ['round_robin', 'q_learning', 'ema'];

let problems = [];
for (const sc of data.scenarios) {
  console.log('\n=== ' + sc.name + ' ===');
  const r = runComparison(sc.sim_config, KINDS, 12345);
  console.log('strategy             goodput  served  timeout  rejected   mean    p95');
  for (const k of KINDS) {
    const s = r[k];
    console.log(
      s.strategy.padEnd(20) +
      String(s.goodputPct + '%').padStart(7) +
      String(s.completed).padStart(8) +
      String(s.timeouts).padStart(9) +
      String(s.rejected).padStart(10) +
      String(s.meanLatency + 'ms').padStart(8) +
      String(s.p95 + 'ms').padStart(8)
    );
    console.log('     dist: ' + s.distribution.map(d => `${d.name}=${d.sharePct}%`).join('  '));
  }
  const rr = r.round_robin, ql = r.q_learning, ema = r.ema;
  const dGood = Math.round((ql.goodputPct - rr.goodputPct) * 10) / 10;
  console.log(`  -> Q-learning goodput vs Round Robin: ${dGood >= 0 ? '+' : ''}${dGood} pts`);
  console.log(`  -> Q-learning goodput vs EMA:         ${(ql.goodputPct - ema.goodputPct).toFixed(1)} pts`);
  if (ql.goodputPct < rr.goodputPct) {
    problems.push(`${sc.name}: Q-learning goodput BELOW Round Robin`);
  }
}

console.log('\n' + '='.repeat(60));
if (problems.length) {
  console.log('Scenarios where Q-learning loses on goodput:');
  problems.forEach(p => console.log('  - ' + p));
  console.log('\nThat is a real result, not necessarily a bug. Report it honestly.');
} else {
  console.log('Q-learning meets or beats Round Robin on goodput in every scenario.');
}
