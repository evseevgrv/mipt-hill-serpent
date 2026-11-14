import { writeFileSync } from 'node:fs';
import { parseRequest, advance, chooseMove, DEFAULT_WEIGHTS, DIRECTIONS } from '../worker/index.js';
import { request, snake } from '../tests/fixtures.mjs';
import { baselineMove } from './opponents.mjs';
function generator(seed) { let value = seed >>> 0; return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; }; }
function asRequest(state, i) {
  const snakes = state.snakes.filter(s => s.alive).map(s => snake(s.id, s.body.map(p => [p % state.w, Math.floor(p / state.w)]), s.health));
  const me = snakes.find(s => s.id === state.snakes[i].id);
  const r = request([me, ...snakes.filter(s => s !== me)], { turn: state.turn, food: [...state.food].map(p => [p % state.w, Math.floor(p / state.w)]) });
  return r;
}
function play(weights, seed, side, opponent) {
  const random = generator(seed);
  const heads = side ? [[9, 9], [1, 1]] : [[1, 1], [9, 9]];
  let state = parseRequest(request(heads.map(([x, y], i) => snake(String(i), [[x, y], [x, y], [x, y]], 100)), { food: [[5, 5], [1, 2], [9, 8]] }));
  for (let turn = 0; turn < 220; turn++) {
    if (!state.snakes[0].alive || !state.snakes[1].alive) return state.snakes[0].alive ? 1 : state.snakes[1].alive ? 0 : 0.5;
    const a = chooseMove(asRequest(state, 0), { weights, maxNodes: 250, maxDepth: 3, budgetMs: 170 }).move;
    const b = opponent === 'incumbent' ? chooseMove(asRequest(state, 1), { weights: DEFAULT_WEIGHTS, maxNodes: 250, maxDepth: 3, budgetMs: 170 }).move : baselineMove(asRequest(state, 1), 'greedy', random);
    state = advance(state, [DIRECTIONS.indexOf(a), DIRECTIONS.indexOf(b)]);
    const occupied = new Set(state.snakes.filter(s => s.alive).flatMap(s => s.body));
    if (state.food.size < 1 || random() < 0.15) {
      const empty = Array.from({ length: state.size }, (_, p) => p).filter(p => !occupied.has(p) && !state.food.has(p));
      if (empty.length) state.food = new Set([...state.food, empty[Math.floor(random() * empty.length)]]);
    }
  }
  return 0.5;
}
function fitness(weights) {
  let points = 0, games = 0;
  for (const opponent of ['incumbent', 'greedy']) for (const seed of [41, 73]) for (const side of [0, 1]) { points += play(weights, seed, side, opponent); games++; }
  return { points, games, fitness: points / games };
}
let current = { ...DEFAULT_WEIGHTS }, best = fitness(current);
const history = [{ iteration: 0, weights: current, ...best, accepted: true }];
const proposals = [['length', 1.6], ['territory', 1.5], ['food', 2], ['trap', 1.5], ['space', 0.6], ['hunger', 1.6]];
for (let i = 0; i < proposals.length; i++) {
  const [key, factor] = proposals[i], candidate = { ...current, [key]: current[key] * factor }, result = fitness(candidate);
  const accepted = result.fitness > best.fitness;
  history.push({ iteration: i + 1, mutation: { key, factor }, weights: candidate, ...result, accepted });
  if (accepted) { current = candidate; best = result; }
  console.log(JSON.stringify({ iteration: i + 1, key, ...result, accepted }));
}
writeFileSync('results/tuning.json', JSON.stringify({ method: 'strict-improvement coordinate hill climbing', seedSet: [41, 73], mirroredStarts: true, gamesPerCandidate: 8, searchNodes: 250, maxDepth: 3, turnLimit: 220, note: 'Local deterministic simulator, current food and 15% spawn. This is tuning evidence, not course baseline results. Holdout evaluation uses the official engine.', history, selected: current }, null, 2) + '\n');
