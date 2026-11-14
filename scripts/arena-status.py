import datetime
import json
import sys
import urllib.request

summaries = []
for game_id in sys.argv[1:]:
    url = f'https://arena.battlesnake.com/api/games/{game_id}'
    with urllib.request.urlopen(url, timeout=20) as response:
        payload = json.load(response)
    game = payload.get('Game', {})
    frame = payload.get('LastFrame') or {}
    summary = {'gameId': game_id, 'url': f'https://arena.battlesnake.com/games/{game_id}', 'status': game.get('ArenaStatus', game.get('Status', 'unavailable')), 'turn': frame.get('Turn'), 'snakes': [{key: snake.get(key) for key in ['Name', 'Health', 'Latency', 'Death', 'EliminatedCause', 'Error']} | {'length': len(snake['Body'])} for snake in frame.get('Snakes', [])]}
    if not game:
        summary['apiResponse'] = payload
    summaries.append(summary)
print(json.dumps({'checkedAt': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).isoformat(), 'games': summaries}, ensure_ascii=False, indent=2))
