import argparse
import concurrent.futures
import datetime as dt
import json
import pathlib
import re
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://arena.battlesnake.com'
PROFILE = BASE + '/battlesnakes/aa1bb9da-902d-4765-999f-ddcb8b2b6c51/profile'
RELEASE_INFO = json.loads((ROOT / 'results/current-release.json').read_text()) if (ROOT / 'results/current-release.json').exists() else {}
RELEASE = RELEASE_INFO.get('releasedAt', '2026-11-21T18:26:35.286203+00:00')
MSK = ZoneInfo('Europe/Moscow')


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'MIPT-Hill-Serpent-Report/1.0', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode('utf-8')


def number(text):
    return float(re.search(r'-?\d+(?:\.\d+)?', text.replace(',', '')).group())


def load_json(path):
    return json.loads((ROOT / path).read_text())


def history(soup, year):
    heading = soup.find('h2', string=lambda s: s and 'Game History' in s)
    result = []
    for row in heading.find_next('table').select('tbody tr'):
        cells = row.select('td')
        link = row.select_one('a[href*="/games/"]')
        if not link or len(cells) < 6:
            continue
        timestamp = dt.datetime.strptime(str(year) + ' ' + cells[0].get_text(' ', strip=True), '%Y %b %d %H:%M').replace(tzinfo=dt.timezone.utc)
        place_text = cells[3].get_text(' ', strip=True)
        match = re.search(r'([1-4])(?:st|nd|rd|th)', place_text)
        draw = 'draw' in place_text.lower()
        live = 'live' in place_text.lower()
        mode = cells[1].get_text(' ', strip=True).split()[0]
        players = int(number(cells[2].get_text()))
        if mode == 'Standard' and players == 2:
            mode = 'Duels'
        result.append({'id': link['href'].split('/')[-1], 'url': BASE + link['href'], 'createdAt': timestamp.isoformat(), 'timeMoscow': timestamp.astimezone(MSK).strftime('%d.%m · %H:%M'), 'mode': mode, 'players': players, 'place': int(match[1]) if match else None, 'draw': draw, 'live': live, 'winner': cells[4].get_text(' ', strip=True), 'afterRelease': timestamp >= dt.datetime.fromisoformat(RELEASE)})
    return result


def leaderboard(html):
    soup = BeautifulSoup(html, 'html.parser')
    result = []
    for table in soup.select('table'):
        headers = [c.get_text(' ', strip=True).lower() for c in table.select('thead th')]
        if 'rating' not in headers or 'games' not in headers:
            continue
        for row in table.select('tbody tr'):
            cells = row.select('td')
            if len(cells) != len(headers):
                continue
            link = cells[1].find('a')
            record = {'rank': int(number(cells[0].get_text())), 'name': link.get_text(' ', strip=True), 'rating': number(cells[headers.index('rating')].get_text()), 'games': int(number(cells[headers.index('games')].get_text())), 'url': BASE + link['href']}
            win_col = next((i for i, h in enumerate(headers) if h.startswith('win')), None)
            record['winRate'] = number(cells[win_col].get_text()) if win_col is not None else None
            result.append(record)
    return result


def leaderboard_pages(url, first_html):
    html = first_html
    rows = []
    seen = set()
    while url not in seen:
        seen.add(url)
        rows += leaderboard(html)
        soup = BeautifulSoup(html, 'html.parser')
        link = next((a['href'] for a in soup.select('a[href]') if a.get_text(strip=True) == 'Next ›'), None)
        if not link:
            break
        url = urllib.parse.urljoin(url, link)
        html = fetch(url)
    return rows


def collect():
    started = dt.datetime.now(dt.timezone.utc)
    soup = BeautifulSoup(fetch(PROFILE), 'html.parser')
    stats = {e.select_one('.label').get_text(strip=True): e for e in soup.select('.stats .stat')}
    summary = {key: number(stats[label].select_one('.value').get_text(' ', strip=True)) for key, label in [('games', 'Games'), ('winRate', 'Win Rate'), ('averagePlace', 'Avg. Placement'), ('p95Ms', 'p95 Latency')]}
    summary['games'] = int(summary['games'])
    summary['wins'] = int(number(stats['Games'].select_one('small').get_text()))
    placements = [int(re.findall(r'\d+', e.get_text())[-1]) for e in stats['Avg. Placement'].select('.stat-detail span')]
    summary['placements'] = dict(zip(['first', 'draw', 'second', 'third', 'fourth'], placements))
    summary['completed'] = sum(placements)
    summary['unresolved'] = summary['games'] - summary['completed']
    latency_text = soup.select_one('.latency-summary').get_text(' ', strip=True)
    summary['latencyGames'] = int(re.search(r'Last (\d+) games', latency_text)[1])
    summary['p50Ms'] = int(re.search(r'p50 (\d+)ms', latency_text)[1])
    summary['timeouts'], summary['movesInLatencySample'] = map(int, re.search(r'(\d+) of (\d+) moves timed out', latency_text).groups())
    summary['timeoutRate'] = summary['timeouts'] / summary['movesInLatencySample'] * 100
    board_table = soup.find('h2', string='Leaderboards').find_next('table')
    boards = []
    for row in board_table.select('tbody tr'):
        cells = row.select('td'); link = cells[0].find('a')
        boards.append({'mode': link.get_text().split()[0], 'rating': number(cells[1].get_text()), 'games': int(number(cells[2].get_text())), 'winRateRounded': number(cells[3].get_text()), 'status': cells[4].get_text(strip=True), 'url': BASE + link['href'], 'boardUrl': BASE + link['href'].split('/entries/')[0]})
    next_link = next((a['href'] for a in soup.select('a[href]') if a.get_text(strip=True) == 'Next ›'), None)
    urls = [BASE + '/rankings', *[b['boardUrl'] for b in boards], *([BASE + next_link] if next_link else []), 'https://mipt-hill-serpent.miniaturegoose4.chatgpt.site/']
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        pages = dict(zip(urls, pool.map(fetch, urls)))
    ranking_soup = BeautifulSoup(pages[BASE + '/rankings'], 'html.parser')
    ranking_rows = []
    for row in ranking_soup.select('tbody tr'):
        cells = row.select('td')
        if len(cells) < 4:
            continue
        user = cells[1].select_one('a[href*="/users/"]')
        if user:
            ranking_rows.append({'rank': int(number(cells[0].get_text())), 'name': user.get_text(' ', strip=True), 'rating': number(cells[2].get_text()), 'url': BASE + user['href']})
    overall = next(r for r in ranking_rows if r['name'].lower() == 'evseevgrv')
    overall['top30Threshold'] = next(r['rating'] for r in ranking_rows if r['rank'] == 30)
    references = []
    for b in boards:
        rows = leaderboard_pages(b['boardUrl'], pages[b['boardUrl']])
        own = next(r for r in rows if r['name'] == 'MIPT Hill Serpent')
        b.update({k: own[k] for k in ['rank', 'rating', 'games', 'winRate']})
        if b['mode'] == 'Duels':
            references = [next(r for r in rows if r['name'].lower() == name) for name in ['novice', 'apprentice', 'journeyman', 'expert']]
    games = history(soup, started.year)
    if next_link:
        games += history(BeautifulSoup(pages[BASE + next_link], 'html.parser'), started.year)
    games = list({g['id']: g for g in games}.values())
    latency = []
    for a in soup.select('.latency-chart a'):
        title = a.find('title')
        if not title:
            continue
        match = re.search(r'(\d{4}-\d\d-\d\d \d\d:\d\d) UTC · p50 (\d+)ms · p95 (\d+)ms · (\d+) timeouts? in (\d+) moves', title.get_text())
        if match:
            time = dt.datetime.strptime(match[1], '%Y-%m-%d %H:%M').replace(tzinfo=dt.timezone.utc)
            latency.append({'id': a['href'].split('/')[-1], 'url': BASE + a['href'], 'createdAt': time.isoformat(), 'timeMoscow': time.astimezone(MSK).strftime('%d.%m · %H:%M'), 'p50': int(match[2]), 'p95': int(match[3]), 'timeouts': int(match[4]), 'moves': int(match[5])})
    assert len(latency) == summary['latencyGames'], 'Incomplete latency chart parsing'
    def game_details(g):
        try:
            payload = json.loads(fetch(BASE + '/api/games/' + g['id']))
            frame = payload.get('LastFrame') or {}
            me = next((s for s in frame.get('Snakes', []) if s.get('Name') == 'MIPT Hill Serpent'), None)
            if not me:
                return g | {'detailUnavailable': True}
            return g | {'turns': frame.get('Turn'), 'death': me.get('Death'), 'length': len(me['Body']), 'health': me['Health'], 'opponents': [s['Name'] for s in frame['Snakes'] if s is not me]}
        except Exception as error:
            return g | {'detailError': str(error)}
    completed_recent = [g for g in games[:50] if not g['live']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        details = list(pool.map(game_details, completed_recent))
    detail_map = {g['id']: g for g in details}
    games = [detail_map.get(g['id'], g) for g in games]
    modes = ['Duels', 'Standard', 'Royale', 'Constrictor']
    boards.sort(key=lambda b: modes.index(b['mode']))
    snapshot = {'capturedAt': started.isoformat(), 'capturedAtMoscow': started.astimezone(MSK).strftime('%d.%m.%Y · %H:%M МСК'), 'collectionFinishedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'releaseAt': RELEASE, 'releaseMoscow': dt.datetime.fromisoformat(RELEASE).astimezone(MSK).strftime('%d.%m.%Y · %H:%M МСК'), 'version': json.loads(pages[urls[-1]])['version'], 'profileUrl': PROFILE, 'rankingsUrl': BASE + '/rankings', 'repositoryUrl': 'https://github.com/evseevgrv/mipt-hill-serpent', 'apiUrl': urls[-1], 'summary': summary, 'overall': overall, 'boards': boards, 'references': references, 'recentGames': games, 'latency': latency, 'detailSampleSize': len(details), 'cpuBenchmark': load_json('results/benchmark-linux-one-cpu.json'), 'liveCheck': load_json('results/live-check-linux.json'), 'ruleConformance': load_json('results/rule-conformance.json'), 'holdoutDuels': load_json('results/improvement-2026-11-21/holdout-duels.json'), 'holdoutFour': load_json('results/improvement-2026-11-21/holdout-four.json'), 'replayBenchmark': load_json('results/improvement-2026-11-21/replay-benchmark.json'), 'before': {'games': 2833, 'wins': 1002, 'winRate': 35.5, 'overallRank': 27, 'overallRating': 120.9, 'boards': {'Duels': 26.5, 'Standard': 47.8, 'Royale': 28.6, 'Constrictor': 18.0}}, 'checks': {'tests': 18, 'cpuCiUrl': 'https://github.com/evseevgrv/mipt-hill-serpent/actions/runs/44935563812', 'apiCiUrl': 'https://github.com/evseevgrv/mipt-hill-serpent/actions/runs/44935565764'}}
    if RELEASE_INFO:
        assert snapshot['version'] == RELEASE_INFO['version'], 'Published version differs from release metadata'
        folder = RELEASE_INFO['comparisonDirectory']
        snapshot.update({'holdoutDuels': load_json(folder + '/holdout-duels.json'), 'holdoutFour': load_json(folder + '/holdout-four.json'), 'rejectedMultiplayer': load_json(folder + '/rejected-all-opponents.json'), 'cloudBenchmark': load_json('results/benchmark-cloud-linux-one-cpu.json'), 'releaseNotes': RELEASE_INFO['notes'], 'checks': RELEASE_INFO['checks']})
    return snapshot


parser = argparse.ArgumentParser()
parser.add_argument('--refresh', action='store_true')
parser.add_argument('--data-only', action='store_true')
parser.add_argument('--snapshot', default='results/report-snapshot-' + dt.datetime.now(MSK).strftime('%Y-%m-%d') + '.json')
parser.add_argument('--output', default='REPORT.html')
args = parser.parse_args()
snapshot_path = ROOT / args.snapshot
if args.refresh:
    data = collect()
    snapshot_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
else:
    data = json.loads(snapshot_path.read_text())
if not args.data_only:
    template = (ROOT / 'templates/report.html').read_text()
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    output = template.replace('__REPORT_DATA__', encoded).replace('__REPORT_TIMESTAMP__', data['capturedAtMoscow'])
    (ROOT / args.output).write_text(output)
    print(ROOT / args.output)
print(json.dumps({'captured': data['capturedAtMoscow'], 'version': data['version'], 'summary': data['summary'], 'overall': data['overall'], 'boards': data['boards'], 'recentGames': len(data['recentGames']), 'latencyPoints': len(data['latency']), 'detailSampleSize': data['detailSampleSize']}, ensure_ascii=False, indent=2))
