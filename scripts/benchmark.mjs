import os from 'node:os';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { chooseMove, VERSION } from '../worker/index.js';
import { request, snake } from '../tests/fixtures.mjs';
const samples = [request(), request(undefined, { mode: 'royale', hazards: Array.from({ length: 11 }, (_, y) => [0, y]) }), request(undefined, { mode: 'constrictor', food: [] }), request([snake('me', [[2, 2], [2, 1], [2, 0]]), snake('a', [[8, 8], [8, 9], [8, 10]]), snake('b', [[2, 8], [2, 9], [2, 10]]), snake('c', [[8, 2], [8, 1], [8, 0]])])];
if (existsSync('results/positions.json')) samples.push(...JSON.parse(readFileSync('results/positions.json')));
if (existsSync('results/improvement-2026-11-21/replay-positions.json')) samples.push(...JSON.parse(readFileSync('results/improvement-2026-11-21/replay-positions.json')).filter(r => r.request?.board).map(r => r.request));
const times = [], cpu = [], depths = [];
for (let i = 0; i < 12; i++) chooseMove(samples[i % samples.length]);
for (let i = 0; i < Math.max(100, samples.length); i++) {
  const body = samples[i % samples.length], start = performance.now(), usage = process.cpuUsage();
  const result = chooseMove(body);
  times.push(performance.now() - start); const consumed = process.cpuUsage(usage); cpu.push((consumed.user + consumed.system) / 1000); depths.push(result.depth);
}
times.sort((a, b) => a - b); cpu.sort((a, b) => a - b);
const q = p => times[Math.min(times.length - 1, Math.floor(times.length * p))];
const output = { version: VERSION, date: new Date().toISOString(), runtime: process.version, cpu: os.cpus()[0].model, architecture: os.arch(), logicalCoresUsedBySearch: 1, cpuAffinity: process.env.CPU_AFFINITY ?? null, note: 'Search is synchronous on one JS thread. OS scheduling and runtime helper threads are not CPU affinity.', samples: times.length, fixtures: samples.length, latencyMs: { p50: q(.5), p95: q(.95), p99: q(.99), max: times.at(-1) }, processCpuMs: { p95: cpu[Math.floor(cpu.length * .95)], max: cpu.at(-1) }, depth: { min: Math.min(...depths), max: Math.max(...depths) }, under500ms: times.every(t => t < 500) };
writeFileSync('results/benchmark.json', JSON.stringify(output, null, 2) + '\n'); console.log(JSON.stringify(output, null, 2));
if (!output.under500ms) process.exitCode = 1;
