import { writeFileSync, readFileSync } from 'node:fs';
import { request, snake } from '../tests/fixtures.mjs';
const url = process.argv[2] ?? 'https://mipt-hill-serpent.miniaturegoose4.chatgpt.site';
const result = { url, date: new Date().toISOString(), endpoints: [], moves: [] };
for (const [path, method, body] of [['/', 'GET'], ['/health', 'GET'], ['/start', 'POST', {}], ['/end', 'POST', {}]]) {
  const response = await fetch(url + path, { method, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  result.endpoints.push({ path, status: response.status, body: await response.json() });
}
const snakes = [snake('me', [[2, 2], [2, 1], [2, 0]]), snake('a', [[8, 8], [8, 9], [8, 10]]), snake('b', [[2, 8], [2, 9], [2, 10]]), snake('c', [[8, 2], [8, 1], [8, 0]])];
const cases = [];
for (const mode of ['duels', 'standard', 'royale', 'constrictor']) for (let repeat = 0; repeat < 3; repeat++) cases.push({ mode, repeat, body: request(mode === 'duels' ? undefined : snakes, { mode: mode === 'duels' ? 'standard' : mode, food: mode === 'constrictor' ? [] : [[5, 5], [3, 4]] }) });
for (const sample of JSON.parse(readFileSync('results/improvement-2026-11-21/replay-positions.json')).filter(r => [4, 40].includes(r.turnsBeforeDeath) && r.request?.board)) cases.push({ mode: 'replay-' + (sample.request.game.map === 'royale' ? 'royale' : sample.request.game.ruleset.name), repeat: 0, body: sample.request });
for (const { mode, repeat, body } of cases) {
  const start = performance.now();
  const response = await fetch(url + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const answer = await response.json();
  const sample = { mode, repeat, status: response.status, rttMs: performance.now() - start, serverTiming: response.headers.get('server-timing'), depth: response.headers.get('x-search-depth'), nodes: response.headers.get('x-search-nodes'), answer };
  if (response.status !== 200 || !['up', 'down', 'left', 'right'].includes(answer.move)) throw new Error(JSON.stringify(sample));
  result.moves.push(sample);
}
result.maxRttMs = Math.max(...result.moves.map(s => s.rttMs));
result.allMovesUnder500ms = result.moves.every(s => s.rttMs < 500);
writeFileSync('results/live-check.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, moves: result.moves.map(s => ({ mode: s.mode, rttMs: Math.round(s.rttMs), depth: s.depth })) }, null, 2));

if (!result.allMovesUnder500ms) process.exitCode = 1;
