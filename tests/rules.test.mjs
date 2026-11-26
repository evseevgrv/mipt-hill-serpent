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

test('Constrictor path capacity discounts branches that require revisiting a cell', async () => {
  const { pathCapacity } = await import('../worker/index.js');
  const s = parseRequest(request([snake('me', [[2, 2]])], { width: 5, height: 5, food: [] }));
  const blocked = new Uint8Array(25).fill(1);
  for (const p of [12, 7, 2, 11, 10, 13, 14]) blocked[p] = 0;
  assert.equal(pathCapacity(s, 12, blocked), 3);
  assert.equal(pathCapacity(s, 2, blocked), 5);
});

test('a shorter healthy snake eats safe adjacent food before starvation', () => {
  const r = request([snake('me', [[1, 1], [1, 0], [0, 0]], 75), snake('other', [[8, 8], [9, 8], [10, 8], [10, 7], [9, 7], [8, 7], [8, 6], [9, 6], [10, 6], [10, 5], [9, 5], [8, 5]])], { food: [[1, 2], [0, 10]] });
  assert.equal(chooseMove(r, { maxNodes: 5000 }).move, 'up');
});

test('reachable cells account for consecutive hazard damage', async () => {
  const { distances } = await import('../worker/index.js');
  const s = parseRequest(request([snake('me', [[0, 0], [0, 0], [0, 0]], 25)], { width: 5, height: 1, food: [[3, 0]], hazards: [[1, 0], [2, 0]] }));
  const map = distances(s, s.snakes[0], new Uint8Array(5)).distance;
  assert.equal(map[1], 1);
  assert.equal(map[2], -1);
  assert.equal(map[3], -1);
});

test('food restores health between hazardous steps', async () => {
  const { distances } = await import('../worker/index.js');
  const s = parseRequest(request([snake('me', [[0, 0], [0, 0], [0, 0]], 17)], { width: 5, height: 1, food: [[2, 0]], hazards: [[1, 0], [2, 0], [3, 0]] }));
  assert.equal(distances(s, s.snakes[0], new Uint8Array(5)).distance[3], 3);
});

test('equal length routes preserve the healthier arrival before expanding hazards', async () => {
  const { distances } = await import('../worker/index.js');
  const s = parseRequest(request([snake('me', [[0, 0], [0, 0], [0, 0]], 40)], { width: 4, height: 2, food: [], hazards: [[0, 1], [2, 1], [3, 1]] }));
  const blocked = new Uint8Array(8);
  blocked[2] = blocked[3] = 1;
  assert.equal(distances(s, s.snakes[0], blocked).distance[7], 4);
});

test('a trapped last opponent is valuable without encouraging attacks on a third snake', async () => {
  const { evaluate, DEFAULT_WEIGHTS } = await import('../worker/index.js');
  const snakes = [snake('me', [[1, 1], [1, 0], [0, 0]]), snake('other', [[4, 3], [4, 2], [3, 2], [3, 3], [3, 4], [2, 4], [2, 3], [2, 2]])];
  const options = { width: 5, height: 5, food: [[0, 4]] };
  const duel = parseRequest(request(snakes, options));
  const withoutTraps = { ...DEFAULT_WEIGHTS, trap: 0 };
  assert.ok(evaluate(duel) > evaluate(duel, withoutTraps));
  const multi = parseRequest(request([...snakes, snake('third', [[0, 3], [0, 2], [0, 1]])], options));
  assert.equal(evaluate(multi), evaluate(multi, withoutTraps));
});

test('cached alpha-beta agrees with exhaustive simultaneous search', async () => {
  const { evaluate } = await import('../worker/index.js');
  function brute(state, depth) {
    if (!depth || !state.snakes[0].alive || !state.snakes.slice(1).some(s => s.alive)) return evaluate(state);
    const options = state.snakes.map((s, i) => s.alive ? legalMoves(state, i) : [0]);
    let best = -Infinity;
    for (const move of options[0].length ? options[0] : [0, 1, 2, 3]) {
      const chosen = [move]; let worst = Infinity;
      function responses(i) {
        if (i === options.length) { worst = Math.min(worst, brute(advance(state, chosen), depth - 1)); return; }
        for (const d of options[i].length ? options[i] : [0, 1, 2, 3]) { chosen[i] = d; responses(i + 1); }
      }
      responses(1); best = Math.max(best, worst);
    }
    return best;
  }
  for (const mode of ['standard', 'constrictor', 'royale']) {
    const r = request([snake('me', [[1, 1], [1, 0], [0, 0]]), snake('other', [[3, 3], [3, 4], [4, 4]])], { width: 5, height: 5, mode, food: mode === 'constrictor' ? [] : [[2, 2]], hazards: mode === 'royale' ? [[0, 1], [0, 2]] : [] });
    const decision = chooseMove(r, { maxDepth: 3, maxNodes: 100000, budgetMs: 170 });
    assert.equal(decision.depth, 3);
    assert.equal(decision.score, brute(parseRequest(r), 3));
  }
});

test('Arena Royale is recognized when the base ruleset is standard', () => {
  const r = request();
  r.game.map = 'royale';
  assert.equal(parseRequest(r).royale, true);
});
