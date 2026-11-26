export const VERSION = '1.4.0';
export const DIRECTIONS = ['up', 'down', 'left', 'right'];
export const DEFAULT_WEIGHTS = Object.freeze({ territory: 2.4, space: 1.4, length: 50, food: 28, hunger: 0.35, trap: 36, center: 0.25, mobility: 5 });
const WIN = 1000000;

export function parseRequest(request) {
  const { board, you } = request;
  if (!board || !you || !Array.isArray(board.snakes) || !you.body?.length || !Number.isInteger(board.width) || !Number.isInteger(board.height) || board.width < 1 || board.height < 1 || board.width * board.height > 2500) throw new Error('Invalid board');
  const w = board.width, h = board.height;
  const rules = request.game?.ruleset ?? {};
  const wrapped = rules.name?.includes('wrapped') || request.game?.map?.includes('wrapped');
  const constrictor = rules.name?.includes('constrictor') || request.game?.map?.includes('constrictor');
  const index = p => p.y * w + p.x;
  const neighbors = Array.from({ length: w * h }, (_, p) => {
    const x = p % w, y = Math.floor(p / w);
    return [[x, y + 1], [x, y - 1], [x - 1, y], [x + 1, y]].map(([a, b]) => wrapped ? ((b + h) % h) * w + ((a + w) % w) : a < 0 || b < 0 || a >= w || b >= h ? -1 : b * w + a);
  });
  const snakes = [you, ...board.snakes.filter(s => s.id !== you.id)].map(s => ({ id: s.id, body: s.body.map(index), health: s.health, alive: true }));
  const hazards = new Int16Array(w * h);
  for (const p of board.hazards ?? []) hazards[index(p)]++;
  return { w, h, size: w * h, neighbors, constrictor: !!constrictor, wrapped: !!wrapped, hazards, damage: rules.settings?.hazardDamagePerTurn ?? 14, royale: rules.name === 'royale' || request.game?.map === 'royale', turn: request.turn ?? 0, snakes, food: new Set((board.food ?? []).map(index)), initialOpponents: snakes.length - 1 };
}

function occupancy(state) {
  const occupied = new Uint8Array(state.size);
  for (const snake of state.snakes) if (snake.alive) for (let j = 0; j < snake.body.length - 1; j++) occupied[snake.body[j]] = 1;
  return occupied;
}

export function legalMoves(state, i, occupied = occupancy(state)) {
  const snake = state.snakes[i];
  if (!snake.alive) return [0];
  const moves = [];
  const adjacent = state.neighbors[snake.body[0]];
  for (let d = 0; d < 4; d++) {
    const p = adjacent[d];
    if (p < 0 || occupied[p]) continue;
    if (!state.food.has(p) && snake.health - 1 - state.hazards[p] * state.damage <= 0) continue;
    moves.push(d);
  }
  return moves;
}

export function advance(state, moves) {
  const eaten = new Set();
  const snakes = state.snakes.map((s, i) => {
    if (!s.alive) return s;
    const p = state.neighbors[s.body[0]][moves[i]];
    const body = [p, ...s.body.slice(0, -1)];
    const eats = state.food.has(p);
    let health = s.health - 1 - (p >= 0 && !eats ? state.hazards[p] * state.damage : 0);
    if (eats) { body.push(body.at(-1)); health = 100; eaten.add(p); }
    return { id: s.id, body, health, alive: p >= 0 && health > 0 };
  });
  const collision = new Uint8Array(state.size);
  for (const s of snakes) if (s.alive) for (let j = 1; j < s.body.length; j++) if (s.body[j] >= 0) collision[s.body[j]] = 1;
  const dead = snakes.map(s => s.alive && !!collision[s.body[0]]);
  for (let i = 0; i < snakes.length; i++) {
    const a = snakes[i];
    if (!a.alive) continue;
    for (let j = 0; j < snakes.length; j++) if (i !== j) {
      const b = snakes[j];
      if (b.alive && a.body[0] === b.body[0] && a.body.length <= b.body.length) dead[i] = true;
    }
  }
  for (let i = 0; i < snakes.length; i++) {
    const s = snakes[i];
    if (dead[i]) s.alive = false;
    if (state.constrictor && s.alive) { s.health = 100; if (s.body.at(-1) !== s.body.at(-2)) s.body.push(s.body.at(-1)); }
  }
  return { ...state, turn: state.turn + 1, snakes, food: eaten.size ? new Set([...state.food].filter(p => !eaten.has(p))) : state.food };
}

export function distances(state, snake, blocked, temporal = false) {
  const distance = new Int16Array(state.size).fill(-1);
  const queue = new Int16Array(state.size);
  const health = new Int16Array(state.size);
  const head = snake.body[0];
  let begin = 0, end = 1;
  queue[0] = head; distance[head] = 0; health[head] = snake.health;
  while (begin < end) {
    const p = queue[begin++], nextDistance = distance[p] + 1;
    for (const q of state.neighbors[p]) {
      if (q < 0 || (distance[q] >= 0 && distance[q] !== nextDistance) || (temporal ? blocked[q] > nextDistance : blocked[q])) continue;
      const remaining = state.food.has(q) ? 100 : health[p] - 1 - state.hazards[q] * state.damage;
      if (remaining <= 0) continue;
      if (distance[q] === nextDistance) { health[q] = Math.max(health[q], remaining); continue; }
      distance[q] = nextDistance; health[q] = remaining; queue[end++] = q;
    }
  }
  return { distance, count: end };
}

function releaseTimes(state) {
  const release = new Int16Array(state.size);
  for (const s of state.snakes) if (s.alive) for (let j = 0; j < s.body.length; j++) release[s.body[j]] = Math.max(release[s.body[j]], state.constrictor ? 30000 : s.body.length - j);
  return release;
}

let capacityScratch;
export function pathCapacity(state, head, blocked) {
  const n = state.size;
  if (capacityScratch?.n !== n) {
    capacityScratch = { n, seen: new Int16Array(n), low: new Int16Array(n), stamp: new Int16Array(n), degree: new Int16Array(n), from: new Int16Array(4 * n), to: new Int16Array(4 * n), vertex: new Int16Array(4 * n), block: new Int16Array(4 * n), first: new Int16Array(2 * n + 1), weight: new Int16Array(2 * n + 1), target: new Int16Array(8 * n), next: new Int16Array(8 * n) };
  }
  const { seen, low, stamp, degree, from, to, vertex, block, first, weight, target, next } = capacityScratch;
  seen.fill(0); stamp.fill(0); degree.fill(0); first.fill(-1); weight.fill(0);
  let tick = 0, edgeCount = 0, memberCount = 0, blockCount = 0, treeEdges = 0;
  function visit(u, parent) {
    seen[u] = low[u] = ++tick;
    for (const v of state.neighbors[u]) {
      if (v < 0 || (blocked[v] && v !== head)) continue;
      if (!seen[v]) {
        from[edgeCount] = u; to[edgeCount++] = v;
        visit(v, u); low[u] = Math.min(low[u], low[v]);
        if (low[v] >= seen[u]) {
          const label = ++blockCount;
          let a, b;
          do {
            a = from[--edgeCount]; b = to[edgeCount];
            for (const p of [a, b]) if (stamp[p] !== label) {
              stamp[p] = label; degree[p]++; vertex[memberCount] = p; block[memberCount++] = label; weight[n + label]++;
            }
          } while (a !== u || b !== v);
        }
      } else if (v !== parent && seen[v] < seen[u]) {
        from[edgeCount] = u; to[edgeCount++] = v; low[u] = Math.min(low[u], seen[v]);
      }
    }
  }
  visit(head, -1);
  if (!blockCount) return 1;
  let root = head;
  function connect(a, b) { target[treeEdges] = b; next[treeEdges] = first[a]; first[a] = treeEdges++; }
  for (let i = 0; i < memberCount; i++) {
    const v = vertex[i], b = n + block[i];
    if (v === head && degree[v] === 1) root = b;
    if (degree[v] > 1) { weight[b]--; weight[v] = 1; connect(v, b); connect(b, v); }
  }
  function longest(u, parent) {
    let best = 0;
    for (let e = first[u]; e >= 0; e = next[e]) if (target[e] !== parent) best = Math.max(best, longest(target[e], u));
    return weight[u] + best;
  }
  return longest(root, -1);
}

export function evaluate(state, weights = DEFAULT_WEIGHTS) {
  const me = state.snakes[0];
  const opponents = state.snakes.slice(1).filter(s => s.alive);
  if (!me.alive) return opponents.length ? -WIN + state.turn : -WIN * 0.5 + state.turn;
  if (state.initialOpponents && !opponents.length) return WIN - state.turn;
  const blocked = occupancy(state);
  const maps = state.snakes.map(s => s.alive ? distances(state, s, blocked) : null);
  const own = maps[0];
  let territory = 0, enemyTerritory = 0;
  for (let p = 0; p < state.size; p++) {
    let winner = -1, best = 30000, longest = -1, tied = false;
    for (let i = 0; i < maps.length; i++) {
      const d = maps[i]?.distance[p] ?? -1;
      if (d < 0) continue;
      const length = state.snakes[i].body.length;
      if (d < best || (d === best && length > longest)) { winner = i; best = d; longest = length; tied = false; }
      else if (d === best && length === longest) tied = true;
    }
    const value = state.hazards[p] ? 0.3 : 1;
    if (winner === 0) territory += value * (tied ? 0.5 : 1);
    else if (winner >= 0) enemyTerritory += value / Math.max(1, opponents.length);
  }
  const largest = Math.max(0, ...opponents.map(s => s.body.length));
  let score = weights.territory * (territory - enemyTerritory) + weights.space * own.count + weights.length * (me.body.length <= largest + 5 ? me.body.length - largest : 5 + 0.15 * (me.body.length - largest - 5));
  const moves = legalMoves(state, 0, blocked);
  score += weights.mobility * moves.length;
  if (state.constrictor) {
    const capacity = pathCapacity(state, me.body[0], blocked);
    const enemySpace = Math.max(0, ...state.snakes.slice(1).filter(s => s.alive).map(s => pathCapacity(state, s.body[0], blocked)));
    let even = 0, odd = 0;
    for (let p = 0; p < state.size; p++) if (own.distance[p] >= 0) ((p % state.w + Math.floor(p / state.w)) % 2 ? odd++ : even++);
    const startsOdd = (me.body[0] % state.w + Math.floor(me.body[0] / state.w)) % 2;
    const parityEstimate = state.wrapped && (state.w % 2 || state.h % 2) ? own.count : 2 * Math.min(even, odd) + (even === odd ? 0 : (startsOdd ? odd > even : even > odd) ? 1 : -1);
    return score + 18 * (Math.min(capacity, parityEstimate) - enemySpace) + 3 * capacity - 12 * moves.length;
  }
  let release;
  function trapRisk(snake, map) {
    const need = Math.min(state.size * 0.7, snake.body.length + 4);
    const capacity = map.count < need + 8 ? pathCapacity(state, snake.body[0], blocked) : map.count;
    if (capacity >= need) return 0;
    release ??= releaseTimes(state);
    const temporal = distances(state, snake, release, true).count;
    const canFollowTail = !state.royale && map.distance[snake.body.at(-1)] >= 0;
    return weights.trap * (need - capacity) * (canFollowTail ? 0.15 : 1) + weights.trap * 2 * Math.max(0, snake.body.length + 1 - temporal);
  }
  score -= trapRisk(me, own);
  if (opponents.length === 1) {
    const i = state.snakes.findIndex((s, i) => i > 0 && s.alive);
    score += 0.75 * trapRisk(state.snakes[i], maps[i]);
  }
  let foodDistance = 30000, foodValue = 0;
  for (const p of state.food) {
    const d = own.distance[p];
    if (d < 0) continue;
    foodDistance = Math.min(foodDistance, d);
    let enemyDistance = 30000;
    for (let i = 1; i < maps.length; i++) {
      const other = maps[i]?.distance[p] ?? -1;
      if (other >= 0 && (state.snakes[i].body.length >= me.body.length || other < d)) enemyDistance = Math.min(enemyDistance, other);
    }
    foodValue = Math.max(foodValue, (enemyDistance > d ? 1 : 0.25) * Math.max(0, 1 - d / (state.w + state.h)));
  }
  const hunger = Math.max(0, 65 - me.health);
  score += (weights.food + hunger * weights.hunger + (me.body.length <= largest ? 35 : 0)) * foodValue;
  score += 0.12 * me.health;
  if (foodDistance < 30000 && foodDistance >= me.health - 3) score -= 500 + 30 * (foodDistance - me.health + 3);
  else if (foodDistance === 30000 && me.health < 25) score -= (25 - me.health) * 16;
  const x = me.body[0] % state.w, y = Math.floor(me.body[0] / state.w);
  score -= weights.center * (Math.abs(x - (state.w - 1) / 2) + Math.abs(y - (state.h - 1) / 2));
  score -= state.hazards[me.body[0]] * (15 + (100 - me.health) * 0.4);
  return score;
}

function orderedMoves(state, i, blocked, preferred) {
  const options = legalMoves(state, i, blocked);
  if (!options.length) return [0, 1, 2, 3];
  const s = state.snakes[i];
  return options.map(d => {
    const p = state.neighbors[s.body[0]][d];
    let score = d === preferred ? 10000 : 0;
    score += state.food.has(p) ? 20 + (100 - s.health) : 0;
    for (const q of state.neighbors[p]) if (q >= 0 && !blocked[q]) score += 4;
    score -= state.hazards[p] * 20;
    return { d, score };
  }).sort((a, b) => b.score - a.score || a.d - b.d).map(o => o.d);
}

export function chooseMove(request, options = {}) {
  const state = parseRequest(request);
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const budgetMs = Math.max(1, Math.min(options.budgetMs ?? 95, (request.game?.timeout ?? 500) * 0.35));
  const deadline = performance.now() + budgetMs;
  const maxNodes = options.maxNodes ?? 5000;
  const maxDepth = options.maxDepth ?? (state.constrictor ? (state.snakes.length <= 2 ? 10 : 4) : state.snakes.length <= 2 ? 14 : 6);
  const table = new Map();
  const stopped = {};
  let nodes = 0, completedDepth = 0;
  const rootMoves = orderedMoves(state, 0, occupancy(state));
  let bestMove = rootMoves[0], bestScore = -Infinity;
  function search(position, depth, alpha, beta) {
    if (++nodes > maxNodes || (nodes % 32 === 0 && performance.now() >= deadline)) throw stopped;
    if (depth === 0 || !position.snakes[0].alive || (position.initialOpponents && !position.snakes.slice(1).some(s => s.alive))) return evaluate(position, weights);
    const key = position.constrictor ? null : position.turn + ':' + position.snakes.map(s => s.alive ? s.health + ':' + s.body.join('.') : '-').join('|') + '/' + [...position.food].join('.');
    const previous = key === null ? undefined : table.get(key);
    if (previous?.depth >= depth) {
      if (previous.bound === 'exact') return previous.score;
      if (previous.bound === 'lower') alpha = Math.max(alpha, previous.score);
      else beta = Math.min(beta, previous.score);
      if (alpha >= beta) return previous.score;
    }
    const boundAlpha = alpha, boundBeta = beta;
    const blocked = occupancy(position);
    const choices = position.snakes.map((s, i) => s.alive ? orderedMoves(position, i, blocked, i === 0 ? previous?.move : undefined) : [0]);
    let best = -Infinity, bestMove = choices[0][0];
    for (const move of choices[0]) {
      const moves = [move];
      let worst = Infinity;
      function responses(i) {
        if (i === choices.length) { worst = Math.min(worst, search(advance(position, moves), depth - 1, alpha, Math.min(beta, worst))); return; }
        for (const d of choices[i]) { moves[i] = d; responses(i + 1); if (worst <= alpha) break; }
      }
      responses(1);
      if (worst > best) { best = worst; bestMove = move; }
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    if (key !== null) table.set(key, { depth, score: best, move: bestMove, bound: best <= boundAlpha ? 'upper' : best >= boundBeta ? 'lower' : 'exact' });
    return best;
  }
  for (let depth = 1; depth <= maxDepth; depth++) {
    let iterationMove = bestMove, iterationScore = -Infinity;
    const ordered = [bestMove, ...rootMoves.filter(d => d !== bestMove)];
    try {
      const blocked = occupancy(state);
      const choices = state.snakes.map((s, i) => i ? orderedMoves(state, i, blocked) : ordered);
      for (const move of ordered) {
        let worst = Infinity;
        const moves = [move];
        function responses(i) {
          if (i === choices.length) { worst = Math.min(worst, search(advance(state, moves), depth - 1, iterationScore, worst)); return; }
          for (const d of choices[i]) { moves[i] = d; responses(i + 1); if (worst <= iterationScore) break; }
        }
        responses(1);
        if (worst > iterationScore) { iterationScore = worst; iterationMove = move; }
      }
      bestMove = iterationMove; bestScore = iterationScore; completedDepth = depth;
      if (Math.abs(bestScore) > WIN * 0.8) break;
    } catch (error) { if (error !== stopped) throw error; break; }
  }
  return { move: DIRECTIONS[bestMove], depth: completedDepth, nodes, score: Number.isFinite(bestScore) ? bestScore : null };
}

const DETAILS = { apiversion: '1', author: 'evseevgrv', color: '#35d0a2', head: 'default', tail: 'default', version: VERSION };
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
export default {
  async fetch(request, env = {}) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'GET' && path === '/') return json(DETAILS);
    if (request.method === 'GET' && path === '/health') return json({ status: 'ok', version: VERSION });
    if (request.method !== 'POST' || !['/start', '/move', '/end'].includes(path)) return json({ error: 'Not found' }, 404);
    if (path !== '/move') return json({});
    if (Number(request.headers.get('Content-Length') ?? 0) > 262144) return json({ error: 'Request too large' }, 413);
    let body;
    try { const text = await request.text(); if (text.length > 262144) return json({ error: 'Request too large' }, 413); body = JSON.parse(text); parseRequest(body); }
    catch { return json({ error: 'Invalid Battlesnake request' }, 400); }
    const start = performance.now();
    const rules = body.game?.ruleset?.name ?? '';
    const constrictor = rules.includes('constrictor') || body.game?.map?.includes('constrictor');
    const count = body.board.snakes.length;
    const maxNodes = env.SEARCH_PROFILE === 'local' ? 5000 : constrictor ? (count > 2 ? 300 : 1000) : count > 2 ? 1000 : 3000;
    const result = chooseMove(body, { maxNodes });
    return json({ move: result.move }, 200, { 'Server-Timing': `search;dur=${(performance.now() - start).toFixed(2)}`, 'X-Search-Depth': String(result.depth), 'X-Search-Nodes': String(result.nodes) });
  }
};
