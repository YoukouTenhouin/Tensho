import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeWhitaker } from '../src/providers/whitaker.ts';
import { RequestFailure } from '../src/core/requests.ts';
const root = new URL('./fixtures/whitaker/', import.meta.url);
const fixture = (word: string) => JSON.parse(readFileSync(new URL(word + '.json', root), 'utf8'));
const evidence = JSON.parse(readFileSync(new URL('evidence.json', root), 'utf8'));

test('retained seven-form evidence preserves every candidate, interpretation, meaning and attribution', () => {
  for (const entry of evidence.records) {
    const actual = normalizeWhitaker(fixture(entry.word));
    assert.equal(actual.outcome, entry.expected.status);
    assert.equal(actual.candidates.length, entry.expected.candidates.length);
    assert.deepEqual(actual.attribution, [entry.expected.attribution]);
    actual.candidates.forEach((candidate, index) => {
      const expected = entry.expected.candidates[index];
      assert.equal(candidate.lemma, expected.headword);
      assert.equal(candidate.stableId, null);
      assert.equal(candidate.provenance.bodyReference, expected.providerBodyReference);
      assert.deepEqual(candidate.lemmaFeatures, expected.lemmaFeatures);
      assert.deepEqual(candidate.grammar, expected.grammaticalInterpretations);
      assert.deepEqual(candidate.meanings, expected.shortMeanings);
    });
  }
});
test('same-spelling candidates remain separate and multiple meanings remain within their candidate', () => {
  const result = normalizeWhitaker(fixture('malum'));
  assert.equal(result.candidates[1]!.lemma, result.candidates[2]!.lemma);
  assert.notDeepEqual(result.candidates[1]!.provenance, result.candidates[2]!.provenance);
  assert.equal(result.candidates[3]!.meanings.length, 2);
  assert.match(normalizeWhitaker(fixture('important')).candidates[0]!.lemma!, /^importo,/);
});
test('missing fields stay missing without converting partial information to no match', () => {
  const raw = fixture('important');
  delete raw.RDF.Annotation.Body.rest.entry.mean;
  delete raw.RDF.Annotation.Body.rest.entry.infl.pers;
  const partial = normalizeWhitaker(raw);
  assert.equal(partial.outcome, 'usable');
  assert.deepEqual(partial.candidates[0]!.meanings, []);
  assert.equal('pers' in partial.candidates[0]!.grammar[0]!, false);
  assert.deepEqual(partial.candidates[0]!.missing, ['English short meanings']);
  raw.RDF.Annotation.Body.rest.entry = {};
  const incomplete = normalizeWhitaker(raw);
  assert.equal(incomplete.outcome, 'missing-information');
  assert.equal(incomplete.candidates.length, 1);
  assert.equal(incomplete.candidates[0]!.lemma, null);
});
test('foreign analyses are excluded while English explanations of Latin records remain valid', () => {
  const raw = fixture('important');
  raw.RDF.Annotation.Body.rest.entry.mean.lang = 'eng';
  assert.equal(normalizeWhitaker(raw).candidates[0]!.meanings.length, 1);
  raw.RDF.Annotation.Body.rest.entry.dict.hdwd.lang = 'eng';
  const foreign = normalizeWhitaker(raw);
  assert.equal(foreign.candidates.length, 0); assert.equal(foreign.excludedForeignRecords, 1);
  assert.equal(foreign.outcome, 'missing-information');
});
test('array annotations and entries retain boundaries; malformed shapes are technical failures', () => {
  const raw = fixture('important');
  raw.RDF.Annotation.Body.rest.entry = [raw.RDF.Annotation.Body.rest.entry, {}];
  raw.RDF.Annotation = [raw.RDF.Annotation];
  assert.equal(normalizeWhitaker(raw).candidates.length, 2);
  for (const malformed of [null, {}, { RDF: {} }, { RDF: { Annotation: {} } }, { RDF: { Annotation: { about: 'error' } } }, { RDF: { Annotation: { Body: 'wrong' } } }]) {
    assert.throws(() => normalizeWhitaker(malformed), error => error instanceof RequestFailure && error.kind === 'format');
  }
});

test('multiple dictionary records within an entry retain each candidate and the shared analysis', () => {
  const raw = fixture('important');
  const entry = raw.RDF.Annotation.Body.rest.entry;
  const dictionaries = [
    { hdwd: { lang: 'lat', $: 'causo, causare, causavi, causatus' }, kind: { $: 'transitive' } },
    { hdwd: { lang: 'lat', $: 'causor, causari, causatus sum' }, kind: { $: 'deponent' } },
  ];
  entry.dict = dictionaries;
  entry.mean = [{ $: 'cause;' }, { $: 'allege an excuse/reason, object; excuse oneself; plead a cause, bring action;' }];
  const result = normalizeWhitaker(raw);
  assert.equal(result.outcome, 'usable');
  assert.deepEqual(result.candidates.map(candidate => candidate.lemma), dictionaries.map(dict => dict.hdwd.$));
  result.candidates.forEach((candidate, index) => {
    assert.deepEqual(candidate.lemmaFeatures, dictionaries[index]);
    assert.deepEqual(candidate.grammar, [entry.infl]);
    assert.deepEqual(candidate.meanings, entry.mean.map((meaning: { $: string }) => meaning.$));
    assert.equal(candidate.provenance.dictIndex, index);
    assert.equal(candidate.stableId, null);
  });
});
