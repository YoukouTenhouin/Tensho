#!/usr/bin/env python3
"""Small accountless integration probe. Sends a fixed finite request set, no retries."""
import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

MORPH = 'https://morph.alpheios.net/api/v1/analysis/word?'
INDEX = 'https://repos1.alpheios.net/lexdata/ls/dat/lat-ls-ids.dat'
FULL = 'https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&'
WORDS = ['important', 'puellae', 'legi', 'amaverunt', 'mālum', 'malum', 'zzqxx']


def fetch(url, accept):
    request = urllib.request.Request(url, headers={'Accept': accept})
    try:
        response = urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read().decode('utf-8')
        return dict(url=url, accept=accept, status=response.code,
                    contentType=response.headers.get('Content-Type'), body=body)


def many(value):
    return [] if value is None else value if isinstance(value, list) else [value]


def normalize(raw, original):
    annotation = raw['RDF']['Annotation']
    candidates = []
    for body in many(annotation.get('Body')):
        for entry in many(body.get('rest', {}).get('entry')):
            # Preserve separate provider bodies even when headwords are identical.
            candidates.append(dict(
                provider='alpheios-whitakerLat', providerLemmaId=None,
                providerBodyReference=body.get('about'), identityScope='response-local',
                headword=entry.get('dict', {}).get('hdwd', {}).get('$'),
                lemmaFeatures=entry.get('dict', {}),
                shortMeanings=[m.get('$') for m in many(entry.get('mean'))],
                grammaticalInterpretations=many(entry.get('infl'))))
    return dict(originalInput=original, queryInput=original, lookupLanguage='lat',
                status='usable' if candidates else 'no-match',
                provider='alpheios-whitakerLat',
                attribution=annotation.get('rights', {}).get('$'),
                candidates=candidates)


def main():
    out = dict(observedAt=datetime.now(timezone.utc).isoformat(), morphology=[], dictionary=[])
    for word in WORDS:
        url = MORPH + urllib.parse.urlencode(dict(word=word, engine='whitakerLat', lang='lat', clientId='tensho-research'))
        response = fetch(url, 'application/json')
        response['normalized'] = normalize(json.loads(response['body']), word)
        out['morphology'].append(response)
    url = out['morphology'][0]['url']
    out['negotiation'] = [fetch(url, accept) for accept in ['application/xml', '*/*']]
    index = fetch(INDEX, 'text/plain')
    keys = {'importo', 'puella', 'amo', 'lex', 'mala', 'lego', '@lego', '@lego1', '@lego2',
            'malum', '@malum', '@malum1', '@malum2', 'malus', '@malus', '@malus1', '@malus2', '@malus3'}
    index['rows'] = [row for row in index.pop('body').splitlines() if row.split('|')[0] in keys]
    out['index'] = index
    for query in ['n=n21985', 'n=n39421', 'n=n26185', 'n=n26186', 'n=n27773', 'n=n27774', 'l=zzqxx', 'l=malum']:
        out['dictionary'].append(fetch(FULL + query, 'text/html'))
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
