import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LookupCoordinator } from '../src/core/lookup.ts';
import type { Identity } from '../src/core/lookup.ts';
import { DictionaryCoordinator } from '../src/core/dictionary.ts';
import { ReadingSession } from '../src/core/reading-session.ts';
import { SessionResults } from '../src/core/session-results.ts';
import { isReadingRecord } from '../src/core/reading-record.ts';
import { readingSessionStorage } from '../src/browser/session-storage.ts';

const identity = (tabId: number): Identity => ({ tabId, frameId: 0, documentId: `document-${tabId}`, topDocumentId: `document-${tabId}`,
  configuration: 'settings', lookupLanguage: 'lat', explanationLanguage: 'en' });
function browser() {
  let values: Record<string, unknown> = {}, quota = Infinity, failure: Error | undefined;
  let nextWrite: (() => Promise<void>) | undefined;
  return { area: { setAccessLevel: async () => {}, get: async () => structuredClone(values), set: async (next: Record<string, unknown>) => {
    const wait = nextWrite; nextWrite = undefined; if (wait) await wait();
    if (failure) throw failure;
    if (Buffer.byteLength(JSON.stringify(next)) > quota) throw new Error('QUOTA_BYTES quota exceeded');
    values = structuredClone(next);
  } }, bytes: () => Buffer.byteLength(JSON.stringify(values)), quota: (value: number) => { quota = value; },
    fail: (error?: Error) => { failure = error; },
    blockWrite: () => {
      let unblock!: () => void, started!: () => void;
      const pending = new Promise<void>(resolve => { unblock = resolve; });
      const entered = new Promise<void>(resolve => { started = resolve; });
      nextWrite = async () => { started(); await pending; };
      return { entered, unblock };
    } };
}
function application(durable = browser(), current: (identity: Identity) => Promise<boolean> = async () => true) {
  let session: ReadingSession | undefined, calls = 0, articleSize = 100, active = [1];
  const changed = (tabId: number) => session?.changed(tabId);
  const lookup = new LookupCoordinator({ analyze: async text => {
    calls++; return { provider: 'Controlled', controlled: true, candidates: [{ lemma: text, stableId: null, meanings: ['meaning'], interpretations: ['noun'] }] };
  } }, (_state, tabId) => changed(tabId), current, (tabId, preserve) => preserve ? dictionaries.suspend(tabId) : dictionaries.invalidate(tabId),
  (identity, current) => session!.prepareLookup(identity.tabId, current));
  const dictionaries = new DictionaryCoordinator({
    resolve: async candidate => { calls++; return { status: 'alternatives', originalHeadword: candidate.lemma, stableLemmaId: null,
      root: candidate.lemma!, provenance: undefined, providerId: 'controlled', automaticSelection: null, exhaustive: false,
      alternatives: ['n1', 'n2'].map(entryId => ({ dictionary: 'Controlled', entryId, rows: [{ key: candidate.lemma!, entryId, line: 1 }], correspondence: 'unverified' })) }; },
    retrieve: async (_resolution, entryId) => { calls++; return { dictionary: 'Controlled', entryId, paragraphs: ['x'.repeat(articleSize)], attribution: ['Credit'], links: [], sourceUrl: `https://fixture.invalid/${entryId}` }; },
  }, tab => lookup.get(tab), changed, current);
  const storage = new SessionResults(readingSessionStorage(durable.area), isReadingRecord);
  session = new ReadingSession({ lookup, dictionaries, storage, current, activeTabs: async () => active, notify: () => {} });
  return { lookup, dictionaries, session, storage, durable, calls: () => calls,
    articleSize: (size: number) => { articleSize = size; }, active: (tabs: number[]) => { active = tabs; } };
}
async function article(app: ReturnType<typeof application>, tabId: number, text: string) {
  await app.lookup.lookup(identity(tabId), text);
  const generation = app.lookup.get(tabId)!.generation;
  await app.dictionaries.resolve(tabId, generation, 0);
  await app.dictionaries.retrieve(tabId, generation, 0, 'n1');
  await app.session.settled();
  return generation;
}

test('production coordination and browser session adapter retain independent tabs, expansion and scroll across worker reconstruction', async () => {
  const app = application(); const first = await article(app, 1, 'malum');
  app.dictionaries.collapse(1, first, 0); app.session.scroll(1, first, 0, 720);
  const second = await article(app, 2, 'puella'); app.session.scroll(2, second, 0, 240);
  await app.session.settled();
  const restarted = application(app.durable); await restarted.session.settled();
  assert.equal(restarted.lookup.get(1)?.text, 'malum'); assert.equal(restarted.lookup.get(2)?.text, 'puella');
  assert.equal(restarted.dictionaries.get(1)[0]?.expanded, false); assert.equal(restarted.dictionaries.get(2)[0]?.expanded, true);
  assert.equal(restarted.dictionaries.get(1)[0]?.articles.n1?.status, 'complete');
  assert.equal(restarted.session.information(1).scroll.y, 720); assert.equal(restarted.session.information(2).scroll.y, 240);
  assert.equal(restarted.calls(), 0);
  restarted.session.scroll(1, first + 99, 0, 900); assert.equal(restarted.session.information(1).scroll.y, 720, 'stale panel cannot change another generation');
  await restarted.lookup.lookup(identity(1), 'amo'); await restarted.session.settled();
  assert.deepEqual(restarted.dictionaries.get(1), {}); assert.equal(restarted.session.information(1).scroll.y, 0);
  const saved = await restarted.storage.get(1); assert.equal(JSON.stringify(saved).includes('malum'), false, 'one selection, no hidden history');
});

test('document or configuration mismatch discards saved results, while a fresh browser session contains no reading text', async () => {
  const app = application(); await article(app, 1, 'malum'); await article(app, 2, 'puella');
  const restored = application(app.durable, async value => value.documentId === 'document-2' && value.configuration === 'settings');
  await restored.session.settled();
  assert.equal(restored.lookup.get(1), undefined); assert.equal(await restored.storage.get(1), undefined);
  assert.equal(restored.lookup.get(2)?.text, 'puella'); assert.equal(restored.calls(), 0);
  restored.lookup.navigate(2, 9); await restored.session.settled(); assert.equal(restored.lookup.get(2)?.text, 'puella');
  restored.lookup.navigate(2, 0); await restored.session.settled(); assert.equal(await restored.storage.get(2), undefined);
  const fresh = application(); await fresh.session.settled(); assert.deepEqual(await fresh.storage.entries(), []);
});

test('a browser action during slow hydration wins and does not resurrect older content', async () => {
  const app = application(); await article(app, 1, 'malum');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const restarted = application(app.durable, async () => { await gate; return true; });
  const request = restarted.lookup.begin(1);
  const lookup = request.lookup(identity(1), 'amo'); release();
  await lookup; await restarted.session.settled();
  assert.equal(restarted.lookup.get(1)?.text, 'amo');
  const saved = await restarted.storage.get(1); assert.equal(saved?.status === 'retained' && saved.value.state.text, 'amo');
});

test('quota eviction clears live inactive state and restores a revisit notice without a query', async () => {
  const app = application(); await article(app, 1, 'malum'); await article(app, 2, 'puella');
  app.session.view(1); app.session.view(2); await app.session.settled();
  app.durable.quota(app.durable.bytes() + 100); app.active([2, 3]);
  await app.lookup.lookup(identity(3), 'amo'); await app.session.settled();
  assert.equal(app.lookup.get(1), undefined); assert.equal(app.dictionaries.get(1)[0], undefined);
  assert.equal(app.session.information(1).retentionNotice, 'Previous result cleared to free space');
  assert.equal(app.lookup.get(2)?.text, 'puella');
  const restarted = application(app.durable); await restarted.session.settled();
  assert.equal(restarted.session.information(1).retentionNotice, 'Previous result cleared to free space'); assert.equal(restarted.calls(), 0);
});

test('an unretainable article preserves completed content in all tabs and exposes its source as a resource outcome', async () => {
  const app = application(); const generation = await article(app, 1, 'malum'); await article(app, 2, 'puella');
  const other = await app.storage.get(2);
  app.durable.quota(app.durable.bytes() + 600); app.articleSize(20_000);
  await app.dictionaries.retrieve(1, generation, 0, 'n2'); await app.session.settled();
  const candidate = app.dictionaries.get(1)[0]!;
  assert.equal(candidate.articles.n1?.status, 'complete');
  assert.equal(candidate.articles.n2?.status, 'not-retained');
  if (candidate.articles.n2?.status !== 'not-retained') assert.fail();
  assert.equal(candidate.articles.n2.sourceUrl, 'https://fixture.invalid/n2');
  assert.deepEqual(await app.storage.get(2), other, 'failed addition does not commit tentative eviction');
  const restarted = application(app.durable); await restarted.session.settled();
  assert.equal(restarted.dictionaries.get(1)[0]?.articles.n2?.status, 'not-retained');
  assert.equal(restarted.dictionaries.get(1)[0]?.articles.n1?.status, 'complete'); assert.equal(restarted.calls(), 0);
});

test('an update queued during eviction cannot resurrect the evicted tab in session storage', async () => {
  const app = application(); const generation = await article(app, 1, 'malum'); await article(app, 2, 'puella');
  app.durable.quota(app.durable.bytes() + 100); app.active([2, 3]);
  const gate = app.durable.blockWrite();
  const lookup = app.lookup.lookup(identity(3), 'amo'); await gate.entered;
  app.dictionaries.collapse(1, generation, 0);
  gate.unblock(); await lookup; await app.session.settled();
  assert.equal(app.lookup.get(1), undefined); assert.equal((await app.storage.get(1))?.status, 'cleared');
  const restarted = application(app.durable); await restarted.session.settled();
  assert.equal(restarted.lookup.get(1), undefined); assert.equal(restarted.session.information(1).retentionNotice, 'Previous result cleared to free space');
});

test('a replacement that cannot fit never restores the superseded selection after worker restart', async () => {
  const app = application(); await app.lookup.lookup(identity(1), 'amo'); await app.session.settled();
  app.durable.quota(app.durable.bytes());
  await app.lookup.lookup(identity(1), 'x'.repeat(256)); await app.session.settled();
  const restarted = application(app.durable); await restarted.session.settled();
  assert.notEqual(restarted.lookup.get(1)?.text, 'amo');
  assert.equal(JSON.stringify(await app.storage.entries()).includes('amo'), false);
});

test('activation and a new lookup during an eviction write preserve the newer intent and its durable result', async () => {
  const app = application(); await article(app, 1, 'malum'); await article(app, 2, 'puella');
  app.durable.quota(app.durable.bytes() + 100); app.active([2, 3]);
  const gate = app.durable.blockWrite();
  const third = app.lookup.lookup(identity(3), 'amo'); await gate.entered;
  app.active([1, 2]); app.session.activate(1);
  const replacement = app.lookup.lookup(identity(1), 'legi');
  gate.unblock(); await Promise.all([third, replacement]); await app.session.settled();
  assert.equal(app.lookup.get(1)?.text, 'legi');
  const restarted = application(app.durable); await restarted.session.settled();
  assert.equal(restarted.lookup.get(1)?.text, 'legi');
});

test('unavailable storage refuses a replacement before dispatch if the previous selection cannot be invalidated', async () => {
  const app = application(); await article(app, 1, 'amo'); const calls = app.calls();
  const dictionary = structuredClone(app.dictionaries.get(1));
  app.durable.fail(new Error('Storage unavailable'));
  await app.lookup.lookup(identity(1), 'legi'); await app.session.settled();
  assert.equal(app.calls(), calls); assert.equal(app.lookup.get(1)?.text, 'amo');
  assert.deepEqual(app.dictionaries.get(1), dictionary);
  assert.match(app.session.information(1).retentionNotice!, /new lookup could not start/);
  app.durable.fail(); const restarted = application(app.durable); await restarted.session.settled();
  assert.equal(restarted.lookup.get(1)?.text, 'amo', 'the replacement was never accepted');
  await app.lookup.lookup(identity(1), 'legi'); await app.session.settled();
  assert.equal(app.lookup.get(1)?.text, 'legi');
});

test('a non-query notice also requires durable invalidation before replacing the current selection', async () => {
  const app = application(); await article(app, 1, 'amo');
  app.durable.fail(new Error('Storage unavailable'));
  app.lookup.notice(identity(1), '', 'Selection unavailable'); await app.session.settled();
  assert.equal(app.lookup.get(1)?.text, 'amo'); assert.equal(app.dictionaries.get(1)[0]?.articles.n1?.status, 'complete');
  app.durable.fail(); app.lookup.notice(identity(1), '', 'Selection unavailable'); await app.session.settled();
  await new Promise<void>(resolve => setImmediate(resolve)); await app.session.settled();
  const restarted = application(app.durable); await restarted.session.settled();
  assert.equal(restarted.lookup.get(1)?.status, 'notice'); assert.equal(restarted.lookup.get(1)?.text, '');
});

test('refusing a replacement leaves an interrupted prior analysis retryable instead of permanently loading', async () => {
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const app = application(browser(), async () => { entered(); await pending; return true; });
  const first = app.lookup.lookup(identity(1), 'amo'); await started; await app.session.settled();
  app.durable.fail(new Error('Storage unavailable'));
  await app.lookup.lookup(identity(1), 'legi'); await app.session.settled();
  release(); await first;
  assert.equal(app.lookup.get(1)?.text, 'amo'); assert.equal(app.lookup.get(1)?.status, 'error');
});
