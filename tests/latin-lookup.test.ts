import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LookupCoordinator } from '../src/core/lookup.ts';
import type { Identity } from '../src/core/lookup.ts';
import { RequestExecutor, requestLimits } from '../src/core/requests.ts';
import { createWhitakerAnalyzer } from '../src/providers/whitaker.ts';
const identity: Identity = { tabId: 1, frameId: 0, documentId: 'doc', topDocumentId: 'doc', configuration: 'latin-en', lookupLanguage: 'lat', explanationLanguage: 'en' };
const fixture = (word: string) => readFileSync(new URL(`./fixtures/whitaker/${word}.json`, import.meta.url), 'utf8');
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function setup(fetcher: typeof fetch, permitted = async (_origins: readonly string[]) => true, executor = new RequestExecutor()) {
  return new LookupCoordinator(createWhitakerAnalyzer({ executor, permitted, fetch: fetcher }), () => {});
}

test('all seven retained responses traverse production coordination and normalization', async () => {
  const words = ['important', 'puellae', 'legi', 'amaverunt', 'mālum', 'malum', 'zzqxx'];
  const counts = [1, 1, 2, 1, 5, 5, 0];
  for (const [index, word] of words.entries()) {
    let calls = 0;
    const coordinator = setup(async (input, init) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://morph.alpheios.net');
      assert.deepEqual(Object.fromEntries(url.searchParams), { word, engine: 'whitakerLat', lang: 'lat', clientId: 'tensho' });
      assert.equal(new Headers(init?.headers).get('Accept'), 'application/json');
      assert.equal(init?.credentials, 'omit'); assert.equal(init?.referrerPolicy, 'no-referrer');
      return new Response(fixture(word), { status: 201 });
    });
    await coordinator.lookup(identity, word);
    const state = coordinator.get(1)!; assert.equal(state.status, 'complete');
    if (state.status !== 'complete') assert.fail('analysis did not complete');
    assert.equal(calls, 1); assert.equal(state.analysis.candidates.length, counts[index]);
    assert.equal(state.analysis.outcome, word === 'zzqxx' ? 'no-match' : 'usable');
    assert.equal(state.analysis.controlled, false);
    if (word === 'important') assert.match(state.analysis.candidates[0]!.lemma!, /^importo,/);
  }
});

test('original selection is retained while only surrounding space and canonical Unicode are normalized for the query', async () => {
  let query: string | null = null;
  const coordinator = setup(async input => { query = new URL(String(input)).searchParams.get('word'); return new Response(fixture('mālum')); });
  const original = '  ma\u0304lum  ';
  await coordinator.lookup(identity, original);
  assert.equal(query, 'mālum'); assert.equal(coordinator.get(1)!.text, original);
});

test('causā with multiple dictionary records completes lookup and preserves all four candidates', async () => {
  const coordinator = setup(async input => {
    assert.equal(new URL(String(input)).searchParams.get('word'), 'causā');
    return new Response(fixture('causā'));
  });
  await coordinator.lookup(identity, 'causā');
  const state = coordinator.get(1)!;
  assert.equal(state.status, 'complete');
  if (state.status !== 'complete') assert.fail('analysis did not complete');
  assert.equal(state.analysis.outcome, 'usable');
  assert.deepEqual(state.analysis.candidates.map(candidate => candidate.lemma), [
    'causa, causae', 'causo, causare, causavi, causatus', 'causor, causari, causatus sum', 'causa',
  ]);
  assert.deepEqual(state.analysis.candidates.map(candidate => candidate.interpretations.length), [3, 1, 1, 1]);
  assert.deepEqual(state.analysis.candidates.map(candidate => candidate.meanings.length), [3, 2, 2, 1]);
  assert.deepEqual(state.analysis.attribution, [JSON.parse(fixture('causā')).RDF.Annotation.rights.$]);
});

test('a selected passage word reaches the production analyzer with canonical query normalization and unchanged original spelling', async () => {
  const queries: string[] = [];
  const coordinator = setup(async input => {
    queries.push(new URL(String(input)).searchParams.get('word')!);
    return new Response(fixture('mālum'));
  });
  const original = ' “ma\u0304lum,” important ';
  await coordinator.lookup(identity, original);
  assert.deepEqual(queries, []);
  const passage = coordinator.get(1)!.passage!;
  assert.equal(passage.words[0]!.text, 'ma\u0304lum');
  await coordinator.selectWord(1, passage.id, 0);
  assert.deepEqual(queries, ['mālum']);
  assert.equal(coordinator.get(1)!.text, 'ma\u0304lum');
  assert.equal(coordinator.get(1)!.passage!.original, original);
});

test('missing or revoked access is checked after queueing and sends zero guarded requests', async () => {
  const executor = new RequestExecutor();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const options = { signal: new AbortController().signal, deadline: performance.now() + 1_000 };
  const blockers = [executor.run(() => held, options), executor.run(() => held, options)];
  let granted = true, guards = 0, requests = 0;
  const coordinator = setup(async () => { requests++; return new Response(fixture('important')); }, async origins => {
    guards++; assert.deepEqual(origins, ['https://morph.alpheios.net/*']); return granted;
  }, executor);
  const lookup = coordinator.lookup(identity, 'important');
  await turn(); assert.equal(guards, 0);
  granted = false; release(); await Promise.all(blockers); await lookup;
  assert.equal(guards, 1); assert.equal(requests, 0);
  const state = coordinator.get(1)!;
  assert.equal(state.status, 'error'); if (state.status === 'error') assert.equal(state.failureKind, 'missing-access');
});

test('exact Unicode word limit reaches provider; oversize, empty and punctuation-only text never does', async () => {
  let calls = 0;
  const coordinator = setup(async () => { calls++; return new Response(fixture('zzqxx')); });
  await coordinator.lookup(identity, '𐌀'.repeat(256)); assert.equal(calls, 1);
  for (const text of ['𐌀'.repeat(257), '', '  ', '—?!']) await coordinator.lookup(identity, text);
  assert.equal(calls, 1);
});

test('late provider completion cannot replace a newer Latin analysis even when network abort is ignored', async () => {
  const finishes: ((response: Response) => void)[] = [];
  const coordinator = setup(async () => new Promise<Response>(resolve => { finishes.push(resolve); }));
  const first = coordinator.lookup(identity, 'puellae'); await turn();
  const second = coordinator.lookup(identity, 'legi'); await turn();
  finishes[1]!(new Response(fixture('legi'))); await second;
  finishes[0]!(new Response(fixture('puellae'))); await first; await turn();
  const state = coordinator.get(1)!;
  assert.equal(state.text, 'legi'); assert.equal(state.status, 'complete');
  if (state.status === 'complete') assert.equal(state.analysis.candidates.length, 2);
});

test('HTTP, format and decoded-size errors are technical failures with one attempt and no automatic retry', async () => {
  for (const [kind, response] of [
    ['http', new Response('', { status: 503 })],
    ['format', new Response('{')],
    ['format', new Response('{}')],
    ['size', new Response(' '.repeat(requestLimits.analysisBytes + 1))],
  ] as const) {
    let calls = 0;
    const coordinator = setup(async () => { calls++; return response; });
    await coordinator.lookup(identity, 'important');
    const state = coordinator.get(1)!;
    assert.equal(state.status, 'error');
    if (state.status === 'error') assert.equal(state.failureKind, kind);
    assert.equal(calls, 1);
  }
});
