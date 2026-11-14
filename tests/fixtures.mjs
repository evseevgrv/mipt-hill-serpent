export function snake(id, body, health = 90) {
  const points = body.map(([x, y]) => ({ x, y }));
  return { id, name: id, body: points, head: points[0], length: body.length, health, latency: '0', shout: '', squad: '' };
}
export function request(snakes = [snake('me', [[2, 2], [2, 1], [2, 0]]), snake('other', [[8, 8], [8, 9], [8, 10]])], options = {}) {
  return { game: { id: 'test', timeout: 500, ruleset: { name: options.mode ?? 'standard', version: 'v1.2.3', settings: { hazardDamagePerTurn: options.damage ?? 14 } } }, turn: options.turn ?? 1, board: { width: options.width ?? 11, height: options.height ?? 11, food: (options.food ?? [[5, 5]]).map(([x, y]) => ({ x, y })), hazards: (options.hazards ?? []).map(([x, y]) => ({ x, y })), snakes }, you: snakes[0] };
}
