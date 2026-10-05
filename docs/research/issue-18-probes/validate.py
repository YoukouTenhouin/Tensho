#!/usr/bin/env python3
"""Offline contract checks, deliberately not a production adapter."""
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from probe import validate

root = Path(__file__).resolve().parent
rows = json.loads((root / 'provider-results.json').read_text())
labels = json.loads((root / 'labels.json').read_text())
checks = validate(rows)
by_case = {r['case']: r['json'] for r in rows}
assert len(rows) == 13 and all(r['status'] == 200 for r in rows)
assert len(by_case['passage']['splits']) == 10
assert 'पाण्डवास्' in by_case['passage']['splits'][0]
assert len(by_case['constituent']['tags']) == 5
assert len(by_case['ambiguity']['tags']) == 12
assert len(by_case['finite']['tags']) == 2
assert by_case['punctuation']['splits'] == []
assert len(by_case['punctuation_nonstrict']['splits']) == 10
assert by_case['punctuation']['input'] == by_case['punctuation_nonstrict']['input']
assert by_case['nfd']['splits'] == [] and len(by_case['nfc']['splits']) == 10
assert by_case['unknown']['splits'] == []
assert any(t[0] == 'मा#२' for t in by_case['suffix']['tags'])

def retain(payload):
    return [{ 'responseLocalIndex': i, 'originalLemma': lemma, 'stableLemmaId': None,
              'interpretation': [{'original': t, 'english': labels.get(t),
                                  'visible': labels.get(t, t)} for t in tags] }
            for i, (lemma,tags) in enumerate(payload['tags'])]

observed = set()
for row in rows:
    if 'tags' not in row['json']:
        continue
    payload = row['json']
    kept = retain(payload)
    assert [[x['originalLemma'],[t['original'] for t in x['interpretation']]] for x in kept] == payload['tags']
    observed.update(t for _,tags in payload['tags'] for t in tags)
assert observed <= labels.keys()
unknown = retain({'tags': [['same',['future-provider-label']],['same',['future-provider-label']]]})
assert len(unknown) == 2 and unknown[0]['responseLocalIndex'] != unknown[1]['responseLocalIndex']
assert unknown[0]['interpretation'][0]['visible'] == 'future-provider-label'
assert unknown[0]['interpretation'][0]['english'] is None
print(json.dumps({'validatedResponses':len(checks),'mappedObservedLabels':len(observed),
 'unknownLabelPreserved':True,'sameSpellingTuplesPreserved':True,'cases':checks},indent=2))
