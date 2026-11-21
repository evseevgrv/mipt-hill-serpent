import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as candidate from '../worker/index.js';
const source = execFileSync('git', ['show', '9f31b23:worker/index.js']);
const baseline = await import(`data:text/javascript;base64,${source.toString('base64')}`);
const positions = JSON.parse(readFileSync('results/improvement-2026-11-21/replay-positions.json')).filter(r => r.request?.board);
const groups = {};
for (const sample of positions) {
  const body = sample.request, mode = body.game.map === 'royale' ? 'royale' : body.game.ruleset.name, count = body.board.snakes.length;
  const oldNodes = mode.includes('constrictor') ? (count > 2 ? 300 : 1000) : count > 2 ? 1000 : 3000;
  const newNodes = mode.includes('constrictor') ? (count > 2 ? 300 : 1000) : count > 2 ? 1000 : 3000;
  const group = groups[mode] ??= { samples: 0, baselineDepth: 0, candidateDepth: 0, baselineMs: 0, candidateMs: 0, changedMoves: 0 };
  const start = performance.now();
  const a = baseline.chooseMove(body, { maxNodes: oldNodes });
  const middle = performance.now();
  const b = candidate.chooseMove(body, { maxNodes: newNodes });
  group.samples++; group.baselineDepth += a.depth; group.candidateDepth += b.depth;
  group.baselineMs += middle - start; group.candidateMs += performance.now() - middle;
  if (a.move !== b.move) group.changedMoves++;
}
for (const g of Object.values(groups)) for (const key of ['baselineDepth', 'candidateDepth', 'baselineMs', 'candidateMs']) g[key] /= g.samples;
const result = { baselineVersion: '1.2.0', candidateVersion: candidate.VERSION, note: 'Recorded losing positions are diagnostic samples, not evidence of improved win rate.', groups };
writeFileSync('results/improvement-2026-11-21/replay-benchmark.json', JSON.stringify(result, null, 2) + '\n');
console.log(result);
