/**
 * sim-engine.js
 *
 * A faithful JavaScript port of the load balancing strategies that run on the
 * ESP32, so the scenario simulations are not hand-waved animations.
 *
 * Every constant below is copied from the firmware, not invented:
 *
 *   QLearning     <- esp32/.../lib/LoadBalancerAlgorithms/src/QLearning.cpp
 *                    alpha 0.3, gamma 0.5, epsilon 1.0, decay 0.95, min 0.05
 *   EmaResponseTime <- .../EmaResponseTime.cpp  (alpha 0.3, optimistic init 1000)
 *   RoundRobin    <- .../RoundRobin.cpp
 *   reward()      <- esp32/MyFirstESP32/src/main.cpp, session-teardown block
 *
 * If you change the firmware, change this file to match, or the simulation
 * stops being evidence and becomes decoration.
 */

/* ------------------------------------------------------------------ *
 *  Reward function - main.cpp
 *
 *      if (duration >= 2000) reward = -50.0;
 *      else                  reward = 1000.0 / (duration + 1.0);
 *
 *  A timed-out session is punished hard. A fast session is rewarded on a
 *  reciprocal curve, so the gap between 40 ms and 900 ms is large in reward
 *  terms even though both "succeeded".
 * ------------------------------------------------------------------ */
export const CLIENT_TIMEOUT_MS = 2000;

export function computeReward(durationMs) {
  if (durationMs >= CLIENT_TIMEOUT_MS) return -50.0;
  return 1000.0 / (durationMs + 1.0);
}

/* ------------------------------------------------------------------ *
 *  Strategies
 * ------------------------------------------------------------------ */

export class RoundRobin {
  constructor(numBackends) {
    this.numBackends = numBackends;
    this.currentIdx = 0;
    this.name = 'Round Robin';
  }
  getNextBackend() {
    const selected = this.currentIdx;
    this.currentIdx = (this.currentIdx + 1) % this.numBackends;
    return selected;
  }
  provideFeedback() { /* stateless by design - this is the point of the comparison */ }
  introspect() { return null; }
}

export class QLearning {
  constructor(numBackends, maxConcurrentClients, rng) {
    this.numBackends = numBackends;
    this.maxStates = maxConcurrentClients + 1;   // +1 to include the zero-connections state
    this.alpha = 0.3;
    this.gamma = 0.5;
    this.epsilon = 1.0;
    this.epsilonDecay = 0.95;
    this.minEpsilon = 0.05;
    this.rng = rng || Math.random;
    this.name = 'Q-Learning';
    this.updates = 0;

    this.qTable = [];
    for (let i = 0; i < this.maxStates; i++) {
      this.qTable.push(new Array(this.numBackends).fill(0.0));
    }
  }

  getNextBackend(currentState) {
    let s = Math.min(currentState, this.maxStates - 1);
    if (s < 0) s = 0;

    // Epsilon-greedy
    if (this.rng() < this.epsilon) {
      this.lastWasExploration = true;
      return Math.floor(this.rng() * this.numBackends);
    }
    this.lastWasExploration = false;

    let bestAction = 0;
    let maxQ = this.qTable[s][0];
    for (let a = 1; a < this.numBackends; a++) {
      if (this.qTable[s][a] > maxQ) {
        maxQ = this.qTable[s][a];
        bestAction = a;
      }
    }
    return bestAction;
  }

  getMaxQ(state) {
    let s = Math.min(state, this.maxStates - 1);
    if (s < 0) s = 0;
    return Math.max(...this.qTable[s]);
  }

  provideFeedback(backendIdx, currentState, nextState, reward) {
    let cs = Math.max(0, Math.min(currentState, this.maxStates - 1));
    let ns = Math.max(0, Math.min(nextState, this.maxStates - 1));

    // The Bellman equation, exactly as in QLearning.cpp
    const oldQ = this.qTable[cs][backendIdx];
    const maxFutureQ = this.getMaxQ(ns);
    this.qTable[cs][backendIdx] = oldQ + this.alpha * (reward + this.gamma * maxFutureQ - oldQ);

    if (this.epsilon > this.minEpsilon) this.epsilon *= this.epsilonDecay;
    if (this.epsilon < this.minEpsilon) this.epsilon = this.minEpsilon;

    this.updates++;
  }

  introspect() {
    return {
      type: 'qtable',
      epsilon: this.epsilon,
      updates: this.updates,
      table: this.qTable.map(row => row.slice()),
    };
  }
}

export class EmaResponseTime {
  constructor(numBackends, learningRate = 0.3) {
    this.numBackends = numBackends;
    this.alpha = learningRate;
    // Optimistic initialisation forces every backend to be tried before the
    // balancer settles - see the comment in EmaResponseTime.cpp
    this.emaRewards = new Array(numBackends).fill(1000.0);
    this.name = 'EMA Response Time';
  }
  getNextBackend() {
    let best = 0;
    for (let i = 1; i < this.numBackends; i++) {
      if (this.emaRewards[i] > this.emaRewards[best]) best = i;
    }
    return best;
  }
  provideFeedback(backendIdx, _cs, _ns, reward) {
    this.emaRewards[backendIdx] =
      reward * this.alpha + this.emaRewards[backendIdx] * (1.0 - this.alpha);
  }
  introspect() {
    return { type: 'ema', scores: this.emaRewards.slice() };
  }
}

export function makeStrategy(kind, numBackends, maxClients, rng) {
  switch (kind) {
    case 'round_robin': return new RoundRobin(numBackends);
    case 'q_learning':  return new QLearning(numBackends, maxClients, rng);
    case 'ema':         return new EmaResponseTime(numBackends);
    default: throw new Error(`unknown strategy: ${kind}`);
  }
}

/* ------------------------------------------------------------------ *
 *  Deterministic RNG
 *
 *  A seeded generator means "run it again" gives the same chart. During a
 *  live demo that matters: the result you rehearsed is the result on screen,
 *  and a sceptical examiner can re-run it and see the same thing.
 * ------------------------------------------------------------------ */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 *  Backend model
 *
 *  Modelled on the real backend in server-client/server.py, which spawns a
 *  THREAD PER REQUEST. That detail drives the shape of the curve:
 *
 *    - Below the thread-pool's comfortable concurrency, requests genuinely do
 *      run in parallel. Two simultaneous requests do not take twice as long.
 *      A naive "every in-flight request adds X%" model is wrong here and
 *      would exaggerate the cost of concentrating load.
 *    - Past that point, threads contend for cores and the GIL, and the
 *      service time climbs.
 *
 *  So the penalty is flat up to FREE_CONCURRENCY and grows beyond it. This
 *  matters for honesty: an over-aggressive queue term would manufacture an
 *  advantage for any strategy that spreads load, which is exactly the result
 *  we are trying to test rather than assume.
 * ------------------------------------------------------------------ */
const FREE_CONCURRENCY = 2;     // requests served truly in parallel
const CONTENTION_PER_REQ = 0.18; // added service time per request beyond that

class Backend {
  constructor(name, baseLatencyMs, idx) {
    this.name = name;
    this.idx = idx;
    this.baseLatencyMs = baseLatencyMs;
    this.originalLatencyMs = baseLatencyMs;
    this.inFlight = 0;
    this.totalRequests = 0;
    this.degraded = false;
  }

  serviceTime(rng) {
    const contended = Math.max(0, this.inFlight - FREE_CONCURRENCY);
    const queuePenalty = 1 + contended * CONTENTION_PER_REQ;
    const jitter = 0.85 + rng() * 0.3;           // +/- 15%
    return this.baseLatencyMs * queuePenalty * jitter;
  }
}

/* ------------------------------------------------------------------ *
 *  The simulation
 *
 *  One instance runs ONE strategy. The page runs several in lockstep on
 *  identical event timelines and identical RNG seeds, so any difference in
 *  the charts is caused by the routing decision and nothing else.
 * ------------------------------------------------------------------ */
export class Simulation {
  constructor(config, strategyKind, seed) {
    this.config = config;
    this.strategyKind = strategyKind;
    this.rng = mulberry32(seed);
    this.maxClients = 7;                       // the ESP32 socket ceiling
    this.strategy = makeStrategy(strategyKind, config.backends, this.maxClients, this.rng);

    this.backends = config.backend_names.map(
      (name, i) => new Backend(name, config.base_latency_ms[i], i)
    );

    this.tick = 0;
    this.activeSessions = [];
    this.wanUp = true;

    // Accumulators
    this.completed = 0;
    this.timeouts = 0;
    this.rejected = 0;
    this.latencySum = 0;
    this.allLatencies = [];

    // Per-tick series for charting
    this.history = {
      ticks: [],
      avgLatency: [],
      p95Latency: [],
      throughput: [],
      timeoutRate: [],
      perBackendShare: this.backends.map(() => []),
      cloudAvailable: [],
    };

    this.windowLatencies = [];
    this.windowCompleted = 0;
    this.windowTimeouts = 0;
    this.eventLog = [];
    this.pendingArrival = 0;
  }

  applyEvent(evt) {
    switch (evt.type) {
      case 'degrade':
        this.backends[evt.target].baseLatencyMs = evt.latency_ms;
        this.backends[evt.target].degraded = true;
        break;
      case 'recover':
        this.backends[evt.target].baseLatencyMs = evt.latency_ms;
        this.backends[evt.target].degraded = false;
        break;
      case 'wan_down':
        this.wanUp = false;
        break;
      case 'wan_up':
        this.wanUp = true;
        break;
    }
    this.eventLog.push({ tick: this.tick, label: evt.label, type: evt.type });
  }

  step() {
    const cfg = this.config;
    const TICK_MS = 50;

    for (const evt of cfg.events) {
      if (evt.at_tick === this.tick) this.applyEvent(evt);
    }

    // --- Arrivals -------------------------------------------------
    // client_count clients each fire every request_interval_ms.
    const arrivalsPerTick = (cfg.client_count * TICK_MS) / cfg.request_interval_ms;
    this.pendingArrival += arrivalsPerTick;
    while (this.pendingArrival >= 1) {
      this.pendingArrival -= 1;
      this.admit();
    }

    // --- Advance in-flight sessions --------------------------------
    const stillActive = [];
    for (const s of this.activeSessions) {
      s.elapsedMs += TICK_MS;
      if (s.elapsedMs >= s.serviceMs || s.elapsedMs >= CLIENT_TIMEOUT_MS) {
        this.complete(s);
      } else {
        stillActive.push(s);
      }
    }
    this.activeSessions = stillActive;

    this.recordTick();
    this.tick++;
  }

  admit() {
    // The ESP32 rejects beyond 7 concurrent sessions with a 503. Modelling
    // this honestly matters: it is a real limit of the platform and hiding it
    // would make the simulation a sales pitch.
    if (this.activeSessions.length >= this.maxClients) {
      this.rejected++;
      return;
    }

    const stateBefore = this.activeSessions.length;
    const idx = this.strategy.getNextBackend(stateBefore);
    const backend = this.backends[idx];

    backend.inFlight++;
    backend.totalRequests++;

    this.activeSessions.push({
      backendIdx: idx,
      elapsedMs: 0,
      serviceMs: backend.serviceTime(this.rng),
      stateAtDispatch: stateBefore,
    });
  }

  complete(session) {
    const backend = this.backends[session.backendIdx];
    backend.inFlight = Math.max(0, backend.inFlight - 1);

    const duration = Math.min(session.elapsedMs, CLIENT_TIMEOUT_MS);
    const timedOut = duration >= CLIENT_TIMEOUT_MS;

    // Feedback path mirrors main.cpp: state is the active-session count at
    // teardown, next state is one fewer.
    const currentState = this.activeSessions.length;
    const reward = computeReward(duration);
    this.strategy.provideFeedback(session.backendIdx, currentState, currentState - 1, reward);

    if (timedOut) {
      this.timeouts++;
      this.windowTimeouts++;
    } else {
      this.completed++;
      this.windowCompleted++;
      this.latencySum += duration;
      this.allLatencies.push(duration);
      this.windowLatencies.push(duration);
    }
  }

  recordTick() {
    const WINDOW = 20;   // ticks per charted point
    if (this.tick % WINDOW !== 0) return;

    const lat = this.windowLatencies;
    const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null;
    const sorted = lat.slice().sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
    const attempts = this.windowCompleted + this.windowTimeouts;

    this.history.ticks.push(this.tick);
    this.history.avgLatency.push(avg === null ? null : Math.round(avg));
    this.history.p95Latency.push(p95 === null ? null : Math.round(p95));
    this.history.throughput.push(
      Math.round((this.windowCompleted / (WINDOW * 50)) * 1000 * 10) / 10
    );
    this.history.timeoutRate.push(
      attempts ? Math.round((this.windowTimeouts / attempts) * 1000) / 10 : 0
    );
    this.history.cloudAvailable.push(this.wanUp ? 1 : 0);

    const totalHits = this.backends.reduce((a, b) => a + b.totalRequests, 0) || 1;
    this.backends.forEach((b, i) => {
      this.history.perBackendShare[i].push(Math.round((b.totalRequests / totalHits) * 1000) / 10);
    });

    this.windowLatencies = [];
    this.windowCompleted = 0;
    this.windowTimeouts = 0;
  }

  run() {
    while (this.tick < this.config.duration_ticks) this.step();
    return this.summary();
  }

  summary() {
    const sorted = this.allLatencies.slice().sort((a, b) => a - b);
    const pct = (p) => sorted.length
      ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))])
      : 0;

    // Every request the client fired: served, timed out, or refused with a 503.
    // Counting rejections is essential. A strategy that lets sessions pile up
    // until the ESP32 runs out of sockets posts a flattering mean latency
    // precisely BECAUSE the slow requests never got served and so never
    // entered the average. From the terminal's point of view a 503 and a
    // timeout are the same event: no answer.
    const offered = this.completed + this.timeouts + this.rejected;
    const failed = this.timeouts + this.rejected;

    return {
      strategy: this.strategy.name,
      strategyKind: this.strategyKind,

      // Primary metric. Fraction of everything offered that got a real answer.
      offered,
      completed: this.completed,
      goodputPct: offered ? Math.round((this.completed / offered) * 1000) / 10 : 0,

      timeouts: this.timeouts,
      rejected: this.rejected,
      failed,
      failureRatePct: offered ? Math.round((failed / offered) * 1000) / 10 : 0,
      timeoutRatePct: offered ? Math.round((this.timeouts / offered) * 1000) / 10 : 0,

      // Latency over SERVED requests only - read it alongside goodput, never
      // on its own.
      meanLatency: this.completed ? Math.round(this.latencySum / this.completed) : 0,
      p50: pct(0.50),
      p95: pct(0.95),
      p99: pct(0.99),

      distribution: this.backends.map(b => ({
        name: b.name,
        requests: b.totalRequests,
        sharePct: Math.round((b.totalRequests / (offered || 1)) * 1000) / 10,
        degraded: b.degraded,
      })),
      history: this.history,
      eventLog: this.eventLog,
      introspect: this.strategy.introspect(),
    };
  }
}

/**
 * Run several strategies over identical conditions.
 *
 * Same seed for every strategy is the whole methodology: same arrival times,
 * same jitter draws, same degradation events. The only independent variable
 * is the routing decision.
 */
export function runComparison(simConfig, strategyKinds, seed = 12345) {
  const out = {};
  for (const kind of strategyKinds) {
    out[kind] = new Simulation(simConfig, kind, seed).run();
  }
  return out;
}
