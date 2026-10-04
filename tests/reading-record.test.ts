import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LookupCoordinator } from '../src/core/lookup.ts';
import type { Analysis, Identity } from '../src/core/lookup.ts';
import { DictionaryCoordinator } from '../src/core/dictionary.ts';
import type { DictionaryProvider } from '../src/providers/latin-dictionary.ts';
import { isReadingRecord } from '../src/core/reading-record.ts';
import type { ReadingRecord } from '../src/core/reading-record.ts';
import { SessionResults } from '../src/core/session-results.ts';

const identity: Identity = { tabId: 1, frameId: 0, documentId: 'document', topDocumentId: 'document', configuration: 'settings', lookupLanguage: 'lat', explanationLanguage: 'en' };
const analysis: Analysis = { provider: 'Controlled', controlled: true, candidates: [{ lemma: 'malum', stableId: null, interpretations: ['noun'], meanings: ['apple'] }] };
function coordination() {
  let calls = 0;
  const provider: DictionaryProvider = {
    resolve: async candidate => { calls++; return { status: 'alternatives', originalHeadword: candidate.lemma, stableLemmaId: null, provenance: undefined,
      root: 'malum', providerId: 'controlled', automaticSelection: null, exhaustive: false,
      alternatives: ['n1', 'n2'].map(entryId => ({ dictionary: 'Controlled', entryId, rows: [{ key: 'malum', entryId, line: 1 }], correspondence: 'unverified' })) }; },
    retrieve: async (_resolution, entryId) => { calls++; return { dictionary: 'Controlled', entryId, paragraphs: ['Complete article'], attribution: ['Credit'], links: [], sourceUrl: `https://fixture.invalid/${entryId}` }; },
  };
  const lookup = new LookupCoordinator({ analyze: async () => { calls++; return analysis; } }, () => {}, async () => true, tabId => dictionaries.invalidate(tabId));
  const dictionaries = new DictionaryCoordinator(provider, tab => lookup.get(tab), () => {}, async () => true);
  return { lookup, dictionaries, calls: () => calls };
}
async function reading(): Promise<ReadingRecord> {
  const app = coordination();
  await app.lookup.lookup(identity, 'malum puella');
  await app.lookup.selectWord(1, app.lookup.get(1)!.passage!.id, 0);
  const state = app.lookup.get(1)!;
  await app.dictionaries.resolve(1, state.generation, 0);
  await app.dictionaries.retrieve(1, state.generation, 0, 'n1');
  app.dictionaries.collapse(1, state.generation, 0);
  return { state, dictionaries: app.dictionaries.get(1), scroll: { x: 0, y: 720 } };
}

test('completed production reading data restores from the session adapter without requests or loss of context', async () => {
  const record = await reading(); assert.equal(isReadingRecord(record), true);
  let persisted: unknown;
  const adapter = { read: async () => structuredClone(persisted), write: async (value: unknown) => { persisted = structuredClone(value); } };
  await new SessionResults(adapter, isReadingRecord).save(1, record, [1]);
  const reloaded = await new SessionResults(adapter, isReadingRecord).get(1);
  assert.equal(reloaded?.status, 'retained'); if (reloaded?.status !== 'retained') assert.fail();
  const app = coordination();
  assert.equal(app.lookup.restore(reloaded.value.state), true);
  assert.equal(app.dictionaries.restore(1, record.state.generation, reloaded.value.dictionaries), true);
  assert.deepEqual(app.lookup.get(1), record.state); assert.deepEqual(app.dictionaries.get(1), record.dictionaries);
  assert.equal(reloaded.value.scroll.y, 720); assert.equal(app.calls(), 0);
  assert.equal(app.dictionaries.get(1)[0]?.expanded, false);
  await app.dictionaries.resolve(1, record.state.generation, 0);
  assert.equal(app.dictionaries.get(1)[0]?.expanded, true); assert.equal(app.calls(), 0, 'reopening uses completed alternatives/articles');
  await app.lookup.lookup(identity, 'puella');
  assert.ok(app.lookup.get(1)!.generation > record.state.generation); assert.deepEqual(app.dictionaries.get(1), {});
});

test('session hydration cannot overwrite a newer action or resurrect a cleared document', async () => {
  const record = await reading(); const app = coordination();
  const pending = app.lookup.begin(1);
  assert.equal(app.lookup.restore(record.state), false);
  assert.equal(app.dictionaries.restore(1, record.state.generation, record.dictionaries), false);
  await pending.lookup(identity, 'puella'); assert.equal(app.lookup.get(1)?.text, 'puella');
  const navigated = coordination(); navigated.lookup.navigate(1, 0);
  assert.equal(navigated.lookup.restore(record.state), false);
  assert.equal(navigated.lookup.get(1), undefined);
});

test('restoration preserves completed work while interrupted pieces require explicit retry', async () => {
  const record = await reading(); record.dictionaries[0]!.articles.n2 = { status: 'loading' };
  const app = coordination(); app.lookup.restore(record.state); app.dictionaries.restore(1, record.state.generation, record.dictionaries);
  assert.equal(app.dictionaries.get(1)[0]!.articles.n1?.status, 'complete');
  assert.equal(app.dictionaries.get(1)[0]!.articles.n2?.status, 'error'); assert.equal(app.calls(), 0);
  await app.dictionaries.retrieve(1, record.state.generation, 0, 'n2', true);
  assert.equal(app.dictionaries.get(1)[0]!.articles.n2?.status, 'complete'); assert.equal(app.calls(), 1);
  const interrupted = coordination();
  interrupted.lookup.restore({ generation: 20, identity, text: 'puella', status: 'loading' });
  assert.equal(interrupted.lookup.get(1)?.status, 'error'); assert.equal(interrupted.calls(), 0);
});

test('stored reading data rejects invalid candidate/article identity, rendering shapes, offsets and source URLs', async () => {
  const original = await reading();
  const changes: ((record: any) => void)[] = [
    record => { record.state.analysis.candidates[0].meanings = 'not an array'; },
    record => { record.dictionaries[9] = record.dictionaries[0]; },
    record => { record.dictionaries[0].articles.n1.value.entryId = 'another-entry'; },
    record => { record.dictionaries[0].articles.n1.value.sourceUrl = 'javascript:alert(1)'; },
    record => { record.state.passage.words[0].start = 1; },
    record => { record.scroll.y = Infinity; },
    record => { record.state.identity.configuration = ''; },
    record => { record.dictionaries[0].resolution.value.stableLemmaId = 'different-candidate'; },
    record => { record.dictionaries[0].articles.n1.value.dictionary = 'another-provider'; },
    record => { record.state.status = { toString: 'invalid coercion' }; },
  ];
  for (const change of changes) { const copy = structuredClone(original); change(copy); assert.equal(isReadingRecord(copy), false); }
  assert.equal(isReadingRecord(original), true);
});
