#!/usr/bin/env python3
"""Controlled contract evidence, not a production adapter or live-service failure test."""
import copy
import json
from pathlib import Path
from provider_probe import normalize


def chain(providers, calls):
    failures = []
    access = []
    for provider in providers:
        name, enabled, granted, result = provider
        if not enabled:
            continue
        if not granted:
            access.append(name)
            continue
        calls.append(name)
        if result['status'] == 'technical-failure':
            failures.append(name)
            continue
        return dict(result, failures=failures, missingAccess=access)
    return dict(status='technical-failure' if failures else 'missing-access' if access else 'unconfigured',
                failures=failures, missingAccess=access)


def main():
    snapshot = json.loads(Path(__file__).with_name('provider-results.json').read_text())
    normalized = [normalize(json.loads(r['body']), r['normalized']['originalInput']) for r in snapshot['morphology']]
    assert [len(r['candidates']) for r in normalized] == [1, 1, 2, 1, 5, 5, 0]
    assert [sum(len(c['grammaticalInterpretations']) for c in r['candidates']) for r in normalized] == [1, 5, 4, 1, 13, 13, 0]
    assert len(normalized[5]['candidates'][3]['shortMeanings']) == 2
    assert normalized[5]['candidates'][1]['headword'] == normalized[5]['candidates'][2]['headword']
    assert all(c['providerLemmaId'] is None for r in normalized for c in r['candidates'])
    partial = copy.deepcopy(json.loads(snapshot['morphology'][0]['body']))
    entry = partial['RDF']['Annotation']['Body']['rest']['entry']
    del entry['mean']
    del entry['infl']['pers']
    partial = normalize(partial, 'important')
    assert partial['status'] == 'usable' and partial['candidates'][0]['shortMeanings'] == []
    assert 'pers' not in partial['candidates'][0]['grammaticalInterpretations'][0]
    usable = normalized[0]
    failed = dict(status='technical-failure')
    absent = dict(status='no-match')
    for result in [usable, partial, absent]:
        calls = []
        got = chain([('first', True, True, result), ('second', True, True, usable)], calls)
        assert calls == ['first'] and got['status'] == result['status']
    for cause in ['network', 'timeout', 'http-403', 'unusable-format']:
        calls = []
        got = chain([('first', True, True, dict(failed, cause=cause)), ('second', True, True, usable)], calls)
        assert calls == ['first', 'second'] and got['failures'] == ['first']
    calls = []
    got = chain([('disabled', False, True, usable), ('ungranted', True, False, usable),
                 ('granted', True, True, failed)], calls)
    assert calls == ['granted'] and got['missingAccess'] == ['ungranted']
    assert got['status'] == 'technical-failure'
    assert chain([], [])['status'] == 'unconfigured'
    analysis = copy.deepcopy(usable)
    calls = []
    dictionary = chain([('dictionary', True, True, failed)], calls)
    assert dictionary['status'] == 'technical-failure' and analysis == usable and calls == ['dictionary']
    print('PASS: live-fixture counts, identity separation, meanings, absent fields; controlled no-match/partial stopping, four technical failures, one attempt, permission gate, independent dictionary failure')


if __name__ == '__main__':
    main()
