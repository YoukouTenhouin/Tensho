import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LookupCoordinator } from '../src/core/lookup.ts';
import type { Identity } from '../src/core/lookup.ts';
import { DictionaryCoordinator } from '../src/core/dictionary.ts';
import { RequestExecutor } from '../src/core/requests.ts';
import { createLatinDictionary } from '../src/providers/latin-dictionary.ts';
import { createWhitakerAnalyzer } from '../src/providers/whitaker.ts';
import { latinDictionary } from '../src/providers/latin-index.ts';

const identity: Identity = { tabId: 1, frameId: 0, documentId: 'doc', topDocumentId: 'doc', configuration: 'latin-en-1', lookupLanguage: 'lat', explanationLanguage: 'en' };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const index = JSON.parse(fixture('lewis-short/index-rows.json')).rows.join('\n');
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

function setup(options: { executor?: RequestExecutor; article?: (id: string) => Promise<Response> } = {}) {
  const calls: { url: string; options?: RequestInit }[] = [];
  let permitted = true, saved: unknown, sourceCurrent = true;
  const executor = options.executor ?? new RequestExecutor();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push({ url: url.href, options: init });
    if (url.hostname === 'morph.alpheios.net') return new Response(fixture(`whitaker/${url.searchParams.get('word')}.json`));
    if (url.href === latinDictionary.indexUrl) return new Response(index);
    const entryId = url.searchParams.get('n')!;
    return options.article ? options.article(entryId) : new Response(fixture(`lewis-short/${entryId}.html`));
  };
  const provider = createLatinDictionary({ executor, permitted: async () => permitted, fetch: fetcher,
    storage: { read: async () => saved, write: async value => { saved = value; } } });
  const analyzer = createWhitakerAnalyzer({ executor, permitted: async () => true, fetch: fetcher });
  const lookup = new LookupCoordinator(analyzer, () => {}, async () => sourceCurrent, tab => dictionary.invalidate(tab));
  const dictionary = new DictionaryCoordinator(provider, tab => lookup.get(tab), () => {}, async () => sourceCurrent);
  const generation = () => lookup.get(1)!.generation;
  return { calls, lookup, dictionary, generation, executor, provider, saved: () => saved,
    permit: (value: boolean) => { permitted = value; }, source: (value: boolean) => { sourceCurrent = value; } };
}

test('production reading path resolves lazily, never auto-selects, and retains multiple full articles without rerunning analysis', async () => {
  const app = setup();
  await app.lookup.lookup(identity, 'legi');
  const analysis = app.lookup.get(1);
  assert.equal(app.calls.length, 1);
  await app.dictionary.resolve(1, app.generation(), 0);
  const candidate = app.dictionary.get(1)[0]!;
  assert.equal(candidate.resolution.status, 'complete');
  assert.deepEqual(candidate.articles, {});
  assert.equal(app.calls.length, 2);
  await app.dictionary.retrieve(1, app.generation(), 0, 'n26185');
  await app.dictionary.retrieve(1, app.generation(), 0, 'n26186');
  assert.equal(candidate.articles.n26185?.status, 'complete');
  assert.equal(candidate.articles.n26186?.status, 'complete');
  assert.equal(app.lookup.get(1), analysis);
  assert.equal(app.calls.length, 4);
  app.dictionary.collapse(1, app.generation(), 0);
  await app.dictionary.resolve(1, app.generation(), 0);
  await app.dictionary.retrieve(1, app.generation(), 0, 'n26185');
  assert.equal(app.calls.length, 4);
  await app.dictionary.resolve(1, app.generation(), 1);
  assert.equal(app.calls.length, 4, 'another candidate reuses validated fresh index');
  assert.deepEqual(Object.keys(app.saved() as object).sort(), ['key', 'storedAt', 'text']);
  for (const call of app.calls) {
    assert.equal(call.options?.credentials, 'omit'); assert.equal(call.options?.referrerPolicy, 'no-referrer');
    assert.equal(call.options?.redirect, 'error');
  }
});

test('dictionary failure stays local and explicit retry recovers without replacing analysis or successful articles', async () => {
  let failing = true;
  const app = setup({ article: async id => failing && id === 'n26186' ? new Response('failure', { status: 503 }) : new Response(fixture(`lewis-short/${id}.html`)) });
  await app.lookup.lookup(identity, 'legi'); const analysis = app.lookup.get(1);
  await app.dictionary.resolve(1, app.generation(), 0);
  await app.dictionary.retrieve(1, app.generation(), 0, 'n26185');
  await app.dictionary.retrieve(1, app.generation(), 0, 'n26186');
  const candidate = app.dictionary.get(1)[0]!;
  assert.equal(candidate.articles.n26186?.status, 'error');
  assert.equal(candidate.articles.n26185?.status, 'complete');
  const count = app.calls.length;
  await app.dictionary.retrieve(1, app.generation(), 0, 'n26186');
  assert.equal(app.calls.length, count, 'no implicit retry');
  failing = false;
  await app.dictionary.retrieve(1, app.generation(), 0, 'n26186', true);
  assert.equal(candidate.articles.n26186?.status, 'complete');
  assert.equal(app.lookup.get(1), analysis);
  assert.equal(app.calls.length, count + 1);
});

test('missing access, queued revocation and unindexed entry requests make no dictionary fetch', async () => {
  const app = setup({ executor: new RequestExecutor({ concurrent: 1, requestMs: 1000 }) });
  await app.lookup.lookup(identity, 'important');
  app.permit(false);
  await app.dictionary.resolve(1, app.generation(), 0);
  const candidate = app.dictionary.get(1)[0]!;
  assert.equal(candidate.resolution.status, 'error');
  assert.equal(app.calls.length, 1);
  app.permit(true);
  await app.dictionary.resolve(1, app.generation(), 0, true);
  const hold = deferred<void>();
  const occupied = app.executor.run(() => hold.promise, { signal: new AbortController().signal, deadline: performance.now() + 1000 });
  const article = app.dictionary.retrieve(1, app.generation(), 0, 'n21985');
  await turn(); app.permit(false); hold.resolve(); await occupied; await article;
  assert.equal(candidate.articles.n21985?.status, 'error');
  assert.equal(app.calls.length, 2);
  await app.dictionary.retrieve(1, app.generation(), 0, 'n999');
  assert.equal(app.calls.length, 2);
});

test('replacement lookup cancels dictionary identity before source capture and rejects late non-aborting completion', async () => {
  const held = deferred<Response>();
  const app = setup({ article: () => held.promise });
  await app.lookup.lookup(identity, 'important');
  await app.dictionary.resolve(1, app.generation(), 0);
  const previousGeneration = app.generation();
  const pending = app.dictionary.retrieve(1, previousGeneration, 0, 'n21985');
  await turn();
  const request = app.lookup.begin(1);
  assert.deepEqual(app.dictionary.get(1), {});
  await app.dictionary.resolve(1, previousGeneration, 0);
  assert.deepEqual(app.dictionary.get(1), {});
  await request.lookup(identity, 'puella');
  held.resolve(new Response(fixture('lewis-short/n21985.html'))); await pending; await turn();
  assert.deepEqual(app.dictionary.get(1), {});
  assert.equal(app.lookup.get(1)?.text, 'puella');
});

test('detached source cannot start dictionary requests or publish a completed article', async () => {
  const app = setup();
  await app.lookup.lookup(identity, 'important'); app.source(false);
  await app.dictionary.resolve(1, app.generation(), 0);
  assert.equal(app.calls.length, 1); assert.deepEqual(app.dictionary.get(1), {});
  const held = deferred<Response>();
  const later = setup({ article: () => held.promise });
  await later.lookup.lookup(identity, 'important'); await later.dictionary.resolve(1, later.generation(), 0);
  const pending = later.dictionary.retrieve(1, later.generation(), 0, 'n21985');
  await turn(); later.source(false); held.resolve(new Response(fixture('lewis-short/n21985.html')));
  await pending; assert.deepEqual(later.dictionary.get(1), {});
});

test('permission removal during article retrieval prevents publishing the returned content', async () => {
  const held = deferred<Response>();
  const app = setup({ article: () => held.promise });
  await app.lookup.lookup(identity, 'important'); await app.dictionary.resolve(1, app.generation(), 0);
  const original = app.lookup.get(1);
  const pending = app.dictionary.retrieve(1, app.generation(), 0, 'n21985');
  await turn(); app.permit(false);
  held.resolve(new Response(fixture('lewis-short/n21985.html'))); await pending;
  const result = app.dictionary.get(1)[0]!.articles.n21985;
  assert.equal(result?.status, 'error');
  if (result?.status === 'error') assert.equal(result.failureKind, 'revoked-access');
  assert.equal(app.lookup.get(1), original);
});

test('identity mismatch remains a local technical failure and explicit retry can recover', async () => {
  let wrong = true;
  const app = setup({ article: async () => new Response(fixture(`lewis-short/${wrong ? 'n39421' : 'n21985'}.html`)) });
  await app.lookup.lookup(identity, 'important'); await app.dictionary.resolve(1, app.generation(), 0);
  await app.dictionary.retrieve(1, app.generation(), 0, 'n21985');
  const result = app.dictionary.get(1)[0]!.articles.n21985;
  assert.equal(result?.status, 'error');
  if (result?.status === 'error') assert.equal(result.failureKind, 'format');
  wrong = false; await app.dictionary.retrieve(1, app.generation(), 0, 'n21985', true);
  assert.equal(app.dictionary.get(1)[0]!.articles.n21985?.status, 'complete');
});
