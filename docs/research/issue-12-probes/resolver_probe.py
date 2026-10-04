#!/usr/bin/env python3
"""Finite issue-12 research probe; --live refreshes only previously missing articles.

Default: replay saved evidence, no network. No production extension implementation.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
OLD = HERE.parent / 'issue-10-probes'
spec = importlib.util.spec_from_file_location('prior_provider', OLD / 'provider_probe.py')
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
ROOTS = ['importo', 'puella', 'lego', 'lex', 'amo', 'mala', 'malus', 'malum', 'zzqxx']
EXPECTED = {'importo': ['n21985'], 'puella': ['n39421'], 'lego': ['n26185', 'n26186'],
            'lex': ['n26431'], 'amo': ['n2280'], 'mala': ['n27674'],
            'malus': ['n27776', 'n27777', 'n27778'], 'malum': ['n27773', 'n27774'], 'zzqxx': []}


def relevant(key, root):
    return key in (root, '@' + root) or re.fullmatch('@' + re.escape(root) + r'[1-9][0-9]*', key)


def resolve(rows, root):
    alternatives = {}
    for row in rows:
        key, identity = row.split('|')[:2]
        if relevant(key, root) and identity != '@':
            if not re.fullmatch(r'n[0-9]+', identity):
                return dict(status='technical-failure', reason='unsupported-index-target')
            alternatives.setdefault(identity, []).append(key)
    return dict(status='alternatives' if alternatives else 'unresolved-mapping',
                alternatives=[dict(dictionary='Lewis & Short', entryId=identity, indexKeys=keys,
                                   correspondence='unverified') for identity, keys in alternatives.items()],
                automaticSelection=None, exhaustive=False)


def article_identity(response, expected):
    if not 200 <= response['status'] < 300:
        return dict(status='technical-failure', reason='http-' + str(response['status']))
    # Bounded response-shape probe; production validation needs a real HTML parser.
    ids = re.findall(r'class="alpheios-lex-entry"\s+lemma-id="([^"]+)"', response['body'])
    if ids != [expected]:
        return dict(status='technical-failure', reason='article-identity-or-format')
    return dict(status='usable', entryId=ids[0])


def chain(outcomes, calls):
    failures = []
    for name, outcome in outcomes:
        calls.append(name)
        if outcome['status'] == 'technical-failure':
            failures.append(dict(provider=name, reason=outcome.get('reason')))
            continue
        return dict(outcome, failures=failures)
    return dict(status='technical-failure', failures=failures)


def capture():
    index = prior.fetch(prior.INDEX, 'text/plain')
    assert index['status'] == 200
    text = index.pop('body')
    rows = text.splitlines()
    assert all(len(row.split('|')) >= 2 for row in rows)
    index.update(sha256=hashlib.sha256(text.encode()).hexdigest(), rowCount=len(rows),
                 rootsScanned=ROOTS,
                 rows=[row for row in rows if any(relevant(row.split('|')[0], root) for root in ROOTS)])
    # Only the six full articles not fetched in issue #10; no retries or morphology calls.
    missing = ['n2280', 'n26431', 'n27674', 'n27776', 'n27777', 'n27778']
    articles = [prior.fetch(prior.FULL + 'n=' + identity, 'text/html') for identity in missing]
    return dict(observedAt=datetime.now(timezone.utc).isoformat(), index=index, newArticles=articles,
                reusedArticles='../issue-10-probes/provider-results.json')


def verify(snapshot):
    old = json.loads((OLD / 'provider-results.json').read_text())
    resolutions = {root: resolve(snapshot['index']['rows'], root) for root in ROOTS}
    for root, expected in EXPECTED.items():
        assert [a['entryId'] for a in resolutions[root]['alternatives']] == expected
        assert resolutions[root]['automaticSelection'] is None
        assert resolutions[root]['exhaustive'] is False
    articles = old['dictionary'] + snapshot['newArticles']
    identities = {}
    for identity in dict.fromkeys(identity for ids in EXPECTED.values() for identity in ids):
        response = next(r for r in articles if r['url'].endswith('n=' + identity))
        identities[identity] = article_identity(response, identity)
        assert identities[identity]['status'] == 'usable', identities[identity]
    normalized = [prior.normalize(json.loads(r['body']), r['normalized']['originalInput']) for r in old['morphology']]
    assert [len(r['candidates']) for r in normalized] == [1, 1, 2, 1, 5, 5, 0]
    assert [sum(len(c['grammaticalInterpretations']) for c in r['candidates']) for r in normalized] == [1, 5, 4, 1, 13, 13, 0]
    cases = []
    for result in normalized:
        candidates = []
        for offset, candidate in enumerate(result['candidates']):
            assert candidate['providerLemmaId'] is None
            root = candidate['headword'].split(',')[0].strip()
            candidates.append(dict(responseLocalPosition=offset, headword=candidate['headword'],
                                   shortMeanings=candidate['shortMeanings'], stableLemmaId=None,
                                   resolution=resolutions[root]))
        cases.append(dict(originalInput=result['originalInput'], lookupLanguage='lat', candidates=candidates))
    for case in cases[4:6]:
        c = case['candidates']
        assert c[1]['headword'] == c[2]['headword'] and c[1]['shortMeanings'] != c[2]['shortMeanings']
        assert len(c[3]['shortMeanings']) == 2
    usable = dict(status='usable', partial=True, alternatives=resolutions['lego']['alternatives'][:1],
                  entryFailures=[dict(entryId='n26186', status='technical-failure')])
    # These outcomes are controlled; only the 403 body below was observed live in #10.
    for terminal in [resolutions['zzqxx'], usable, dict(status='confirmed-no-entry', evidence='controlled')]:
        calls = []
        outcome = chain([('first', terminal), ('second', usable)], calls)
        assert calls == ['first'] and outcome['status'] == terminal['status']
    live403 = next(r for r in old['dictionary'] if r['url'].endswith('l=zzqxx'))
    failure = article_identity(live403, 'n0')
    assert failure == dict(status='technical-failure', reason='http-403')
    for fault in [failure, dict(status='technical-failure', reason='controlled-network'),
                  dict(status='technical-failure', reason='controlled-timeout'),
                  article_identity(dict(status=200, body='<p>bad shape</p>'), 'n0'),
                  article_identity(dict(status=200, body='<div class="alpheios-lex-entry" lemma-id="n1">'), 'n2')]:
        analysis = copy.deepcopy(normalized)
        calls = []
        outcome = chain([('first', fault), ('second', usable)], calls)
        assert calls == ['first', 'second'] and outcome['failures'][0]['reason'] == fault['reason']
        assert analysis == normalized
    bounded = resolve(['lego|n26185', '@lego2|n26186', '@legos2|n999', '@lego20x|n998'], 'lego')
    assert [a['entryId'] for a in bounded['alternatives']] == ['n26185', 'n26186']
    return dict(status='PASS', roots=resolutions, articleIdentities=identities, cases=cases,
                fallback='PASS: unresolved/confirmed-no-entry/partial stop; technical failures alone advance; analysis retained',
                absenceEvidence='No live dictionary no-entry established; HTTP 403 is technical failure')


if __name__ == '__main__':
    path = HERE / 'resolver-evidence.json'
    if '--live' in sys.argv:
        path.write_text(json.dumps(capture(), ensure_ascii=False, indent=2) + '\n')
    summary = verify(json.loads(path.read_text()))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
