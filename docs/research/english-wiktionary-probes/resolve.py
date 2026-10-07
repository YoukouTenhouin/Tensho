"""Two bounded official API requests: metadata resolution, then pinned article."""
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

params = dict(action='query', titles='book', redirects='1', prop='revisions',
              rvprop='ids', format='json', formatversion='2')
rows = []
for step in range(2):
    url = 'https://zh.wiktionary.org/w/api.php?' + urlencode(params)
    request = Request(url, headers={'User-Agent':
        'TenshoResearch/0.1 (https://github.com/YoukouTenhouin/Tensho)'})
    with urlopen(request, timeout=15) as response:
        raw = response.read(1048577)
        if len(raw) > 1048576:
            raise ValueError('Exceeded 1 MiB response bound')
        payload = json.loads(raw)
        rows.append(dict(url=url, status=response.status, bytes=len(raw),
                         observed_at=datetime.now(timezone.utc).isoformat(),
                         sha256=hashlib.sha256(raw).hexdigest(), payload=payload))
    if step == 0:
        page = payload['query']['pages'][0]
        params = dict(action='parse', oldid=page['revisions'][0]['revid'],
                      prop='text|revid', variant='zh-hans', format='json',
                      formatversion='2', disableeditsection='1')
        time.sleep(1)
assert rows[0]['payload']['query']['pages'][0]['revisions'][0]['revid'] == rows[1]['payload']['parse']['revid']
Path(__file__).with_name('resolution-results.json').write_text(
    json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
print('Metadata resolution and pinned article retrieval passed')
