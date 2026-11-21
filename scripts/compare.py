import argparse
import json
import pathlib
import subprocess
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--candidate', default='http://127.0.0.1:8080')
parser.add_argument('--baseline', default='http://127.0.0.1:8082')
parser.add_argument('--games', type=int, default=11)
parser.add_argument('--seed-start', type=int, default=13001)
parser.add_argument('--modes', nargs='+', default=['standard', 'royale', 'constrictor'])
parser.add_argument('--players', type=int, choices=[2, 4], default=2)
parser.add_argument('--output', default='results/improvement-2026-11-21/comparison.json')
args = parser.parse_args()
with urllib.request.urlopen(args.candidate) as response:
    candidate_version = json.load(response)['version']
root = pathlib.Path('results/games'); root.mkdir(exist_ok=True)
suites = []
for mode in args.modes:
    games = []
    for game in range(args.games):
        seed = args.seed_start + game
        path = root / f'compare-{mode}-{args.players}-{seed}.jsonl'
        entries = [('candidate', args.candidate), ('baseline', args.baseline)]
        if args.players == 4:
            entries += [('greedy', 'http://127.0.0.1:8081/greedy'), ('oneply', 'http://127.0.0.1:8081/oneply')]
        if game % 2:
            entries.reverse()
        command = ['tools/battlesnake', 'play', '-W', '11', '-H', '11', '-g', mode, '--seed', str(seed), '--timeout', '500', '--output', str(path)]
        for name, url in entries:
            command += ['--name', name, '--url', url]
        start = time.monotonic()
        run = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=240)
        (root / f'{path.stem}.log').write_text(run.stdout)
        if run.returncode:
            raise RuntimeError(run.stdout[-2000:])
        rows = [row for line in path.read_text().splitlines() if 'board' in (row := json.loads(line))]
        last_alive = {name: max((r['turn'] for r in rows if any(s['name'] == name for s in r['board']['snakes'])), default=-1) for name in ['candidate', 'baseline']}
        outcome = 'win' if last_alive['candidate'] > last_alive['baseline'] else 'loss' if last_alive['candidate'] < last_alive['baseline'] else 'draw'
        winner_names = [s['name'] for s in rows[-1]['board']['snakes']]
        games.append({'seed': seed, 'outcome': outcome, 'lastAliveTurn': last_alive, 'winnerNames': winner_names, 'seconds': round(time.monotonic() - start, 3), 'warnings': [line for line in run.stdout.splitlines() if 'WARN' in line or 'ERROR' in line]})
        print(mode, args.players, seed, outcome, last_alive, flush=True)
    suite = {'mode': mode, 'players': args.players, 'games': games, **{name: sum(g['outcome'] == value for g in games) for name, value in [('wins', 'win'), ('losses', 'loss'), ('draws', 'draw')]}}
    suites.append(suite)
    pathlib.Path(args.output).write_text(json.dumps({'baselineCommit': '9f31b23a9f94d7409a08907c137f81e9bc6b0565', 'candidateVersion': candidate_version, 'engine': 'BattlesnakeOfficial/rules v1.2.3', 'profile': 'cloud', 'metric': 'candidate survives longer than v1.2.0, including in four-player games', 'suites': suites}, indent=2) + '\n')
