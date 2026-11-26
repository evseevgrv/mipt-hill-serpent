import os from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { chooseMove, parseRequest, VERSION } from '../worker/index.js';
import { request, snake } from '../tests/fixtures.mjs';

const samples = [request(), request(undefined, { mode: 'royale' }), request(undefined, { mode: 'constrictor', food: [] }), request([snake('me', [[2, 2], [2, 1], [2, 0]]), snake('a', [[8, 8], [8, 9], [8, 10]]), snake('b', [[2, 8], [2, 9], [2, 10]]), snake('c', [[8, 2], [8, 1], [8, 0]])])];
samples.push(...JSON.parse(readFileSync('results/positions.json')));
for (const date of ['2026-11-21', '2026-11-26']) samples.push(...JSON.parse(readFileSync(`results/improvement-${date}/replay-positions.json`)).filter(r => r.request?.board).map(r => r.request));
const clock = globalThis.performance;
const fixedClock = { now: () => 0 };
function search(body) {
  const state = parseRequest(body), count = state.snakes.length;
  const maxNodes = state.constrictor ? (count > 2 ? 300 : 1000) : count > 2 ? 1000 : 3000;
  // Workers can freeze performance.now() during synchronous execution.
  // Measure the full production node budget with a separate real clock.
  globalThis.performance = fixedClock;
  try { return chooseMove(body, { maxNodes }); }
  finally { globalThis.performance = clock; }
}
for (let i = 0; i < 12; i++) search(samples[i]);
const times = [], groups = {};
for (const body of samples) {
  const start = clock.now();
  const decision = search(body);
  const ms = clock.now() - start;
  times.push(ms);
  const state = parseRequest(body), mode = state.constrictor ? 'constrictor' : state.royale ? 'royale' : body.board.snakes.length === 2 ? 'duels' : 'standard';
  const group = groups[mode] ??= { samples: 0, maxMs: 0, maxNodes: 0 };
  group.samples++; group.maxMs = Math.max(group.maxMs, ms); group.maxNodes = Math.max(group.maxNodes, decision.nodes);
}
times.sort((a, b) => a - b);
const result = { version: VERSION, date: new Date().toISOString(), runtime: process.version, cpu: os.cpus()[0].model, architecture: os.arch(), cpuAffinity: process.env.CPU_AFFINITY ?? null, samples: times.length, profile: 'production node caps with frozen search clock', latencyMs: { p50: times[Math.floor(times.length * .5)], p95: times[Math.floor(times.length * .95)], max: times.at(-1) }, groups, under500ms: times.every(t => t < 500) };
writeFileSync('results/benchmark-cloud.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.under500ms) process.exitCode = 1;
