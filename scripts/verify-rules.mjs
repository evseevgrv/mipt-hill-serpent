import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseRequest, advance } from '../worker/index.js';
let transitions = 0, games = 0;
for (const file of readdirSync('results/games').filter(f => f.endsWith('.jsonl'))) {
  const rows = readFileSync(`results/games/${file}`, 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.board);
  games++;
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    if (b.turn !== a.turn + 1 || a.board.snakes.length !== b.board.snakes.length) continue;
    const state = parseRequest({ ...a, you: a.board.snakes[0] });
    const moves = state.snakes.map(s => {
      const other = b.board.snakes.find(t => t.id === s.id);
      const target = other.head.y * state.w + other.head.x;
      return state.neighbors[s.body[0]].indexOf(target);
    });
    assert.ok(moves.every(d => d >= 0), `${file} turn ${a.turn}: invalid movement`);
    const predicted = advance(state, moves);
    for (const s of predicted.snakes) {
      const actual = b.board.snakes.find(t => t.id === s.id);
      assert.equal(s.alive, true, `${file} turn ${a.turn}: unexpected elimination`);
      assert.equal(s.health, actual.health, `${file} turn ${a.turn}: health`);
      assert.deepEqual(s.body, actual.body.map(p => p.y * state.w + p.x), `${file} turn ${a.turn}: body`);
    }
    transitions++;
  }
}
const result = { engine: 'BattlesnakeOfficial/rules v1.2.3', games, checkedTransitions: transitions, result: 'all compared bodies and health match', limitation: 'Transitions with eliminations are covered by unit scenarios, not this reconstruction, because the CLI omits eliminated snakes.' };
writeFileSync('results/rule-conformance.json', JSON.stringify(result, null, 2) + '\n');
console.log(result);
