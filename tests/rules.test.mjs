import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { parseRequest, advance, legalMoves, chooseMove } from '../worker/index.js';
import { request, snake } from './fixtures.mjs';

test('wall and neck are excluded', () => {
  const s = parseRequest(request([snake('me', [[0, 0], [0, 1], [0, 2]])]));
  assert.deepEqual(legalMoves(s, 0), [3]);
});
test('vacating tail can be entered even on an eating turn', () => {
  const r = request([snake('me', [[1, 1], [1, 0], [0, 0], [0, 1]])], { food: [[0, 1]] });
  const s = parseRequest(r), next = advance(s, [2]);
  assert.ok(legalMoves(s, 0).includes(2));
  assert.equal(next.snakes[0].alive, true);
  assert.deepEqual(next.snakes[0].body, [11, 12, 1, 0, 0]);
  assert.equal(next.snakes[0].health, 100);
});
test('stacked tail stays occupied', () => {
  const s = parseRequest(request([snake('me', [[1, 1], [1, 0], [0, 0], [0, 1], [0, 1]])]));
  assert.ok(!legalMoves(s, 0).includes(2));
  assert.equal(advance(s, [2]).snakes[0].alive, false);
});
test('equal heads both die, larger head survives', () => {
  for (const longer of [false, true]) {
    const a = snake('me', [[1, 2], [1, 1], [1, 0], ...(longer ? [[0, 0]] : [])]);
    const b = snake('other', [[3, 2], [3, 1], [3, 0]]);
    const s = advance(parseRequest(request([a, b])), [3, 2]);
    assert.equal(s.snakes[0].alive, longer);
    assert.equal(s.snakes[1].alive, false);
  }
});
test('body collisions resolve simultaneously', () => {
  const a = snake('me', [[2, 2], [2, 1], [1, 1]]), b = snake('other', [[3, 2], [3, 1], [4, 1]]);
  const s = advance(parseRequest(request([a, b])), [3, 2]);
  assert.deepEqual(s.snakes.map(s => s.alive), [false, false]);
});
test('food prevents starvation and hazard damage', () => {
  const r = request([snake('me', [[1, 1], [1, 0], [0, 0]], 1)], { food: [[1, 2]], hazards: [[1, 2]] });
  const s = advance(parseRequest(r), [0]);
  assert.equal(s.snakes[0].alive, true);
  assert.equal(s.snakes[0].health, 100);
});
test('hazards can kill and repeated hazards stack damage', () => {
  const r = request([snake('me', [[1, 1], [1, 0], [0, 0]], 28)], { food: [], hazards: [[1, 2], [1, 2]] });
  assert.equal(advance(parseRequest(r), [0]).snakes[0].alive, false);
});
test('Constrictor does not free the duplicated tail and keeps growing', () => {
  let s = parseRequest(request([snake('me', [[1, 1], [1, 0], [0, 0], [0, 0]], 100)], { mode: 'constrictor', food: [] }));
  for (let i = 0; i < 3; i++) { const length = s.snakes[0].body.length; s = advance(s, [0]); assert.equal(s.snakes[0].body.length, length + 1); assert.equal(s.snakes[0].health, 100); }
});
test('wrapped board joins opposite edges', () => {
  const s = parseRequest(request([snake('me', [[0, 2], [0, 1], [0, 0]])], { mode: 'wrapped' }));
  assert.equal(advance(s, [2]).snakes[0].body[0], 32);
});
test('search avoids an immediate losing head collision', () => {
  const r = request([snake('me', [[1, 2], [1, 1], [1, 0]]), snake('other', [[3, 2], [3, 1], [3, 0], [4, 0]])]);
  const decision = chooseMove(r, { maxNodes: 1000, budgetMs: 100 });
  assert.notEqual(decision.move, 'right');
  assert.ok(decision.depth >= 1);
});
test('search takes the only life-saving food', () => {
  const r = request([snake('me', [[1, 1], [1, 0], [0, 0]], 1)], { food: [[1, 2]] });
  assert.equal(chooseMove(r, { maxNodes: 1000 }).move, 'up');
});
test('HTTP protocol and invalid input', async () => {
  const invoke = (path, body) => worker.fetch(new Request(`http://localhost${path}`, body === undefined ? {} : { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
  const details = await (await invoke('/')).json();
  assert.equal(details.apiversion, '1');
  assert.equal((await invoke('/health')).status, 200);
  for (const p of ['/start', '/end']) assert.deepEqual(await (await invoke(p, {})).json(), {});
  assert.equal((await invoke('/move', '{')).status, 400);
  assert.equal((await invoke('/move', {})).status, 400);
  assert.equal((await invoke('/missing')).status, 404);
  const response = await invoke('/move', request());
  assert.equal(response.status, 200);
  assert.ok(['up', 'down', 'left', 'right'].includes((await response.json()).move));
});
