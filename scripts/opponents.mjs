import http from 'node:http';
import { parseRequest, legalMoves, advance, evaluate, DIRECTIONS } from '../worker/index.js';

export function baselineMove(body, level = 'greedy', random = Math.random) {
  const state = parseRequest(body);
  const moves = legalMoves(state, 0);
  if (!moves.length) return 'up';
  if (level === 'random') return DIRECTIONS[moves[Math.floor(random() * moves.length)]];
  let best = moves[0], score = -Infinity;
  for (const d of moves) {
    const p = state.neighbors[state.snakes[0].body[0]][d];
    let value;
    if (level === 'greedy') {
      const distance = Math.min(100, ...[...state.food].map(f => Math.abs(f % state.w - p % state.w) + Math.abs(Math.floor(f / state.w) - Math.floor(p / state.w))));
      value = -distance + random() * 0.1;
      for (let i = 1; i < state.snakes.length; i++) if (state.snakes[i].body.length >= state.snakes[0].body.length && state.neighbors[state.snakes[i].body[0]].includes(p)) value -= 100;
    } else {
      value = Infinity;
      const choices = state.snakes.map((s, i) => i ? legalMoves(state, i) : [d]);
      const selected = [d];
      function visit(i) {
        if (i === choices.length) { value = Math.min(value, evaluate(advance(state, selected))); return; }
        for (const move of choices[i].length ? choices[i] : [0]) { selected[i] = move; visit(i + 1); }
      }
      visit(1);
    }
    if (value > score) { score = value; best = d; }
  }
  return DIRECTIONS[best];
}

if (process.argv[1]?.endsWith('opponents.mjs')) {
  const port = Number(process.env.PORT ?? 8081);
  http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const level = req.url.split('/').filter(Boolean)[0] ?? 'greedy';
    if (req.method === 'GET') { res.end(JSON.stringify({ apiversion: '1', color: '#d07835', head: 'default', tail: 'default' })); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const result = req.url.endsWith('/move') ? { move: baselineMove(JSON.parse(Buffer.concat(chunks)), level) } : {};
    res.end(JSON.stringify(result));
  }).listen(port, '127.0.0.1', () => console.log(`Local test opponents on :${port}`));
}
