"""Bounded official-API research; not a production provider or coverage test."""
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
cases = [(word, 'zh-hans') for word in
         ['book', 'saw', 'good', 'go', 'gift', "don't", 'ice-cream', 'tenshoxyzunknown', 'I', 'the', "he's", 'is', 'Wasser', '水']]
cases += [('book', 'zh-hant')]
results = json.loads((ROOT / 'provider-results.json').read_text()) if (ROOT / 'provider-results.json').exists() else []
for word, variant in cases:
    if any(r['word'] == word and r['variant'] == variant for r in results):
        continue
    params = dict(action='parse', page=word, prop='text|revid|tocdata',
                  format='json', formatversion='2', variant=variant,
                  disableeditsection='1', redirects='1')
    url = 'https://zh.wiktionary.org/w/api.php?' + urlencode(params)
    record = dict(word=word, variant=variant, url=url,
                  observed_at=datetime.now(timezone.utc).isoformat())
    try:
        req = Request(url, headers={'User-Agent':
            'TenshoResearch/0.1 (https://github.com/YoukouTenhouin/Tensho; English-Chinese research)'})
        with urlopen(req, timeout=15) as response:
            raw = response.read(1048577)
            if len(raw) > 1048576:
                raise ValueError('Exceeded 1 MiB response bound')
            record.update(status=response.status, bytes=len(raw),
                          sha256=hashlib.sha256(raw).hexdigest(),
                          content_type=response.headers.get('Content-Type'))
        record['payload'] = json.loads(raw)
        results.append(record)
        if record['payload'].get('error', {}).get('code') not in (None, 'missingtitle'):
            break
    except Exception as error:
        record['error'] = str(error)
        results.append(record)
        break
    time.sleep(1)
(ROOT / 'provider-results.json').write_text(
    json.dumps(results, ensure_ascii=False, indent=2) + '\n')
print(json.dumps([{k: v for k, v in r.items() if k != 'payload'} for r in results], indent=2))
