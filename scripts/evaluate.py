import argparse
import json
import pathlib
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--engine', default='tools/battlesnake')
parser.add_argument('--bot', default='http://127.0.0.1:8080')
parser.add_argument('--opponent', help='URL of a real opponent, when available')
parser.add_argument('--games', type=int, default=11)
parser.add_argument('--output', default='results/evaluation.json')
args = parser.parse_args()
root = pathlib.Path('results/games')
root.mkdir(parents=True, exist_ok=True)
if args.opponent:
    suites = [('duels-external', 'standard', [args.opponent], args.games)]
else:
    suites = [('duels-greedy', 'standard', ['http://127.0.0.1:8081/greedy'], args.games),
              ('duels-oneply', 'standard', ['http://127.0.0.1:8081/oneply'], args.games),
              ('standard', 'standard', ['http://127.0.0.1:8081/greedy', 'http://127.0.0.1:8081/oneply', 'http://127.0.0.1:8081/greedy'], 3),
              ('royale', 'royale', ['http://127.0.0.1:8081/greedy', 'http://127.0.0.1:8081/oneply', 'http://127.0.0.1:8081/greedy'], 3),
              ('constrictor', 'constrictor', ['http://127.0.0.1:8081/greedy', 'http://127.0.0.1:8081/oneply', 'http://127.0.0.1:8081/greedy'], 3)]
results = []
positions = []
for name, mode, opponents, count in suites:
    games = []
    for game in range(count):
        seed = 7001 + game
        path = root / f'{name}-{seed}.jsonl'
        entries = [('hill', args.bot), *[(f'opponent-{i}', url) for i, url in enumerate(opponents)]]
        if game % 2:
            entries.reverse()
        command = [args.engine, 'play', '-W', '11', '-H', '11', '-g', mode, '--timeout', '500', '--seed', str(seed), '--output', str(path)]
        for snake_name, url in entries:
            command += ['--name', snake_name, '--url', url]
        started = time.monotonic()
        run = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
        (root / f'{name}-{seed}.log').write_text(run.stdout)
        if run.returncode:
            raise RuntimeError(run.stdout[-2000:])
        lines = [item for line in path.read_text().splitlines() if 'board' in (item := json.loads(line))]
        final = lines[-1]
        survivors = [s['name'] for s in final['board']['snakes']]
        outcome = 'win' if survivors == ['hill'] else 'draw' if not survivors else 'loss'
        latencies = [float(s.get('latency') or 0) for line in lines for s in line['board']['snakes'] if s['name'] == 'hill']
        games.append({'seed': seed, 'outcome': outcome, 'turns': final['turn'], 'seconds': round(time.monotonic() - started, 3), 'maxReportedLatencyMs': max(latencies, default=0), 'engineWarnings': [line for line in run.stdout.splitlines() if 'WARN' in line or 'ERROR' in line]})
        for line in lines[5::25]:
            me = next((s for s in line['board']['snakes'] if s['name'] == 'hill'), None)
            if me and len(positions) < 150:
                line['you'] = me
                positions.append(line)
        print(name, game + 1, outcome, final['turn'], flush=True)
    row = {'suite': name, 'mode': mode, 'opponents': opponents, 'games': games, **{outcome + 's': sum(g['outcome'] == outcome for g in games) for outcome in ['win', 'loss', 'draw']}}
    results.append(row)
    pathlib.Path(args.output).write_text(json.dumps({'engine': 'BattlesnakeOfficial/rules v1.2.3', 'realCourseBaselines': bool(args.opponent), 'note': 'Local greedy and oneply opponents are original test policies, not Novice/Apprentice/Journeyman/Expert.', 'suites': results}, indent=2) + '\n')
pathlib.Path('results/positions.json').write_text(json.dumps(positions) + '\n')
