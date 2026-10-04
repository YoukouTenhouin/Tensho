import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../src/core/configuration.ts';
import type { ProviderCatalog, ProviderDeclaration } from '../src/core/configuration.ts';
import { ProviderRouter } from '../src/core/provider-router.ts';
import { LookupCoordinator } from '../src/core/lookup.ts';
import type { Analysis, Identity } from '../src/core/lookup.ts';
import { DictionaryCoordinator } from '../src/core/dictionary.ts';
import { RequestFailure } from '../src/core/requests.ts';
import type { DictionaryProvider } from '../src/providers/latin-dictionary.ts';
import type { DictionaryResolution } from '../src/providers/latin-index.ts';
import type { DictionaryArticle } from '../src/providers/latin-article.ts';

function declaration(id: string, role: 'analysis' | 'dictionary'): ProviderDeclaration {
  return { id, name: id, capabilities: [{ lookupLanguage: 'lat', role, explanationLanguages: ['en'], inputNotations: ['Controlled Unicode'] }],
    origins: [`https://${id}.invalid/*`], attribution: ['Controlled evidence'], options: {}, defaultEnabled: true };
}
const catalog: ProviderCatalog = { languages: [{ id: 'lat', name: 'Latin', defaultExplanation: 'en' }],
  providers: [declaration('analysis', 'analysis'), declaration('first', 'dictionary'), declaration('second', 'dictionary'), declaration('third', 'dictionary')] };
const analysis: Analysis = { provider: 'analysis', controlled: true, candidates: [1, 2].map(index => ({
  lemma: 'malum', stableId: `candidate-${index}`, interpretations: [], meanings: [`Meaning ${index}`],
})) };
function resolution(candidate: Analysis['candidates'][number], provider: string): DictionaryResolution {
  return { status: 'alternatives', originalHeadword: candidate.lemma, stableLemmaId: candidate.stableId, provenance: candidate.provenance,
    root: 'malum', automaticSelection: null, exhaustive: false,
    alternatives: ['n1', 'n2'].map(entryId => ({ dictionary: provider, entryId, rows: [{ key: 'malum', entryId, line: 1 }], correspondence: 'unverified' })) };
}
function article(provider: string, entryId: string): DictionaryArticle {
  return { dictionary: provider, entryId, paragraphs: [`${provider} complete article with Latin mālum and Greek ἅμα`], attribution: ['Credit'], links: [], sourceUrl: `https://${provider}.invalid/${entryId}` };
}
async function setup(overrides: Record<string, Partial<DictionaryProvider>> = {}, denied: string[] = []) {
  const settings = defaultSettings(catalog, 'configured'); const calls: string[] = []; let analyses = 0;
  const adapters: Record<string, DictionaryProvider> = {};
  for (const id of ['first', 'second', 'third']) adapters[id] = {
    supportsCandidate: overrides[id]?.supportsCandidate,
    resolve: async (...args) => { calls.push(`${id}:resolve:${args[0].stableId}`); return overrides[id]?.resolve?.(...args) ?? resolution(args[0], id); },
    retrieve: async (...args) => { calls.push(`${id}:article:${args[1]}`); return overrides[id]?.retrieve?.(...args) ?? article(id, args[1]); },
  };
  const identity: Identity = { tabId: 1, frameId: 0, documentId: 'doc', topDocumentId: 'doc', configuration: settings.revision, lookupLanguage: 'lat', explanationLanguage: 'en' };
  const router = new ProviderRouter({ catalog, settings: async () => structuredClone(settings),
    permitted: async origins => !denied.some(id => origins.includes(`https://${id}.invalid/*`)),
    analyzers: { analysis: { analyze: async () => { analyses++; return analysis; } } }, dictionaries: adapters });
  const lookup = new LookupCoordinator(router, () => {}, async () => true, tab => dictionaries.invalidate(tab));
  const dictionaries = new DictionaryCoordinator(router, tab => lookup.get(tab), () => {}, async () => true);
  await lookup.lookup(identity, 'malum'); const state = lookup.get(1)!;
  return { settings, calls, identity, router, lookup, dictionaries, state, analyses: () => analyses };
}

test('technical dictionary resolution failure offers the later provider alternatives with reasons and no automatic article', async () => {
  const app = await setup({ first: { resolve: async () => { throw new RequestFailure('network', 'First dictionary offline'); } } });
  await app.dictionaries.resolve(1, app.state.generation, 0);
  const candidate = app.dictionaries.get(1)[0]!;
  assert.equal(candidate.resolution.status, 'complete'); if (candidate.resolution.status !== 'complete') assert.fail();
  const value = candidate.resolution.value;
  assert.equal(value.providerId, 'second'); assert.equal(value.stableLemmaId, 'candidate-1'); assert.equal(value.automaticSelection, null);
  assert.deepEqual(value.providerIssues?.map(issue => [issue.providerId, issue.operation, issue.kind]), [['first', 'resolution', 'network']]);
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'second:resolve:candidate-1']); assert.deepEqual(candidate.articles, {});
  await app.dictionaries.retrieve(1, app.state.generation, 0, 'n1');
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'second:resolve:candidate-1', 'second:article:n1']);
  const retrieved = candidate.articles.n1; assert.equal(retrieved?.status, 'complete');
  if (retrieved?.status === 'complete') { assert.equal(retrieved.value.dictionary, 'second'); assert.match(retrieved.value.paragraphs[0]!, /mālum and Greek ἅμα/); assert.equal(retrieved.value.providerIssues?.length, 1); }
  assert.equal(app.lookup.get(1), app.state); assert.equal(app.analyses(), 1);
});

test('confirmed absence, unresolved mapping and valid alternatives terminate dictionary resolution without gap filling', async () => {
  for (const status of ['confirmed-absence', 'unresolved-mapping', 'alternatives'] as const) {
    const app = await setup({ first: { resolve: async candidate => ({ ...resolution(candidate, 'first'), status,
      alternatives: status === 'alternatives' ? resolution(candidate, 'first').alternatives : [], evidence: 'Controlled authoritative absence' }) } });
    await app.dictionaries.resolve(1, app.state.generation, 0);
    assert.deepEqual(app.calls, ['first:resolve:candidate-1']);
    const work = app.dictionaries.get(1)[0]!.resolution; assert.equal(work.status, 'complete');
    if (work.status === 'complete') assert.equal(work.value.status, status);
  }
});

test('disabled, unsupported-input and ungranted dictionary providers are skipped without requests', async () => {
  const app = await setup({ second: { supportsCandidate: () => false } }, ['first']);
  await app.dictionaries.resolve(1, app.state.generation, 0);
  assert.deepEqual(app.calls, ['third:resolve:candidate-1']);
  const work = app.dictionaries.get(1)[0]!.resolution; assert.equal(work.status, 'complete');
  if (work.status === 'complete') assert.deepEqual(work.value.providerIssues?.map(issue => [issue.providerId, issue.attempted]), [['first', false], ['second', false]]);
  const disabled = await setup(); disabled.settings.languages.lat!.dictionary[0]!.enabled = false;
  await disabled.dictionaries.resolve(1, disabled.state.generation, 0);
  assert.deepEqual(disabled.calls, ['second:resolve:candidate-1']);
});

test('exhausted dictionary chains retry locally and keep same-spelling analysis candidates distinct', async () => {
  const fail = async () => { throw new RequestFailure('http', 'Controlled service failure'); };
  const app = await setup({ first: { resolve: fail }, second: { resolve: fail }, third: { resolve: fail } });
  await app.dictionaries.resolve(1, app.state.generation, 0);
  const work = app.dictionaries.get(1)[0]!.resolution; assert.equal(work.status, 'error');
  if (work.status === 'error') assert.equal(work.providerIssues?.length, 3);
  await app.dictionaries.resolve(1, app.state.generation, 0, true);
  await app.dictionaries.resolve(1, app.state.generation, 1);
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'second:resolve:candidate-1', 'third:resolve:candidate-1',
    'first:resolve:candidate-1', 'second:resolve:candidate-1', 'third:resolve:candidate-1',
    'first:resolve:candidate-2', 'second:resolve:candidate-2', 'third:resolve:candidate-2']);
  assert.equal(app.lookup.get(1), app.state); assert.equal(app.analyses(), 1);
});

test('a first article failure advances to later alternatives without silently selecting a same-id article', async () => {
  const app = await setup({ first: { retrieve: async () => { throw new RequestFailure('identity-mismatch', 'Wrong article identity'); } } });
  await app.dictionaries.resolve(1, app.state.generation, 0);
  await app.dictionaries.retrieve(1, app.state.generation, 0, 'n1', false, 'first');
  const candidate = app.dictionaries.get(1)[0]!;
  assert.equal(candidate.resolution.status, 'complete'); if (candidate.resolution.status !== 'complete') assert.fail();
  assert.equal(candidate.resolution.value.providerId, 'second'); assert.equal(candidate.resolution.value.stableLemmaId, 'candidate-1');
  assert.equal(candidate.resolution.value.automaticSelection, null); assert.deepEqual(candidate.articles, {});
  assert.deepEqual(candidate.resolution.value.providerIssues?.map(issue => [issue.providerId, issue.operation, issue.kind]), [['first', 'article', 'identity-mismatch']]);
  const before = [...app.calls];
  await app.dictionaries.retrieve(1, app.state.generation, 0, 'n1', false, 'first');
  assert.deepEqual(app.calls, before, 'a stale button cannot select an identically named alternative from another provider');
  await app.dictionaries.retrieve(1, app.state.generation, 0, 'n1', false, 'second');
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'first:article:n1', 'second:resolve:candidate-1', 'second:article:n1']);
  assert.equal(candidate.articles.n1?.status, 'complete'); assert.equal(app.lookup.get(1), app.state); assert.equal(app.analyses(), 1);
});

test('once one article succeeds later failure and retry stay local without filling gaps from another dictionary', async () => {
  let failure = true;
  const app = await setup({ first: { retrieve: async (_resolution, entryId) => {
    if (entryId === 'n2' && failure) throw new RequestFailure('network', 'Second article offline');
    return article('first', entryId);
  } } });
  await app.dictionaries.resolve(1, app.state.generation, 0);
  await app.dictionaries.retrieve(1, app.state.generation, 0, 'n1');
  const preserved = app.dictionaries.get(1)[0]!.articles.n1;
  await app.dictionaries.retrieve(1, app.state.generation, 0, 'n2');
  assert.equal(app.dictionaries.get(1)[0]!.articles.n1, preserved);
  assert.equal(app.dictionaries.get(1)[0]!.articles.n2?.status, 'error');
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'first:article:n1', 'first:article:n2']);
  failure = false;
  await app.dictionaries.retrieve(1, app.state.generation, 0, 'n2', true);
  assert.equal(app.dictionaries.get(1)[0]!.articles.n2?.status, 'complete');
  assert.equal(app.dictionaries.get(1)[0]!.articles.n1, preserved);
  assert.equal(app.calls.filter(call => call.startsWith('second:')).length, 0); assert.equal(app.lookup.get(1), app.state);
});

test('queued article choices cannot mix providers when an earlier choice starts fallback', async () => {
  let release!: () => void;
  const app = await setup({ first: { retrieve: async () => { await new Promise<void>(resolve => { release = resolve; }); throw new RequestFailure('network', 'First article failed'); } } });
  await app.dictionaries.resolve(1, app.state.generation, 0);
  const first = app.dictionaries.retrieve(1, app.state.generation, 0, 'n1');
  const queued = app.dictionaries.retrieve(1, app.state.generation, 0, 'n2');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'first:article:n1']);
  release(); await Promise.all([first, queued]);
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'first:article:n1', 'second:resolve:candidate-1']);
  assert.deepEqual(app.dictionaries.get(1)[0]!.articles, {});
});

test('a concurrent first success is retained before a queued failure and prevents fallback', async () => {
  let release!: () => void;
  const app = await setup({ first: { retrieve: async (_resolution, entryId) => {
    if (entryId === 'n2') throw new RequestFailure('network', 'Later article failed');
    await new Promise<void>(resolve => { release = resolve; }); return article('first', entryId);
  } } });
  await app.dictionaries.resolve(1, app.state.generation, 0);
  const first = app.dictionaries.retrieve(1, app.state.generation, 0, 'n1');
  const later = app.dictionaries.retrieve(1, app.state.generation, 0, 'n2');
  await new Promise<void>(resolve => setImmediate(resolve)); release(); await Promise.all([first, later]);
  assert.equal(app.dictionaries.get(1)[0]!.articles.n1?.status, 'complete');
  assert.equal(app.dictionaries.get(1)[0]!.articles.n2?.status, 'error');
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'first:article:n1', 'first:article:n2']);
});

test('article failure followed by exhausted resolution preserves both operation failures and offers local retry', async () => {
  const fail = async () => { throw new RequestFailure('http', 'Dictionary unavailable'); };
  const app = await setup({ first: { retrieve: fail }, second: { resolve: fail }, third: { resolve: fail } });
  await app.dictionaries.resolve(1, app.state.generation, 0);
  await app.dictionaries.retrieve(1, app.state.generation, 0, 'n1');
  const work = app.dictionaries.get(1)[0]!.resolution; assert.equal(work.status, 'error');
  if (work.status === 'error') assert.deepEqual(work.providerIssues?.map(issue => [issue.providerId, issue.operation]),
    [['first', 'article'], ['second', 'resolution'], ['third', 'resolution']]);
  await app.dictionaries.resolve(1, app.state.generation, 0, true);
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'first:article:n1', 'second:resolve:candidate-1', 'third:resolve:candidate-1', 'first:resolve:candidate-1']);
  assert.equal(app.lookup.get(1), app.state);
});

test('outer dictionary action deadline retains prior reasons and rejects stalled fallback completion', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let release!: (value: DictionaryResolution) => void;
  const app = await setup({ first: { retrieve: async () => { throw new RequestFailure('network', 'First article failed'); } },
    second: { resolve: () => new Promise(resolve => { release = resolve; }) } });
  await app.dictionaries.resolve(1, app.state.generation, 0);
  const work = app.dictionaries.retrieve(1, app.state.generation, 0, 'n1');
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(30_001); await work;
  const failed = app.dictionaries.get(1)[0]!.resolution; assert.equal(failed.status, 'error');
  if (failed.status === 'error') { assert.equal(failed.failureKind, 'action-deadline'); assert.deepEqual(failed.providerIssues?.map(issue => issue.providerId), ['first']); }
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'first:article:n1', 'second:resolve:candidate-1']);
  release(resolution(analysis.candidates[0]!, 'second')); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(app.dictionaries.get(1)[0]!.resolution, failed); assert.equal(app.lookup.get(1), app.state);
});

test('a previously failed resolver does not turn later missing article access into a technical failure', async () => {
  const denied: string[] = [];
  const app = await setup({ first: { resolve: async () => { throw new RequestFailure('network', 'First resolver offline'); } } }, denied);
  await app.dictionaries.resolve(1, app.state.generation, 0);
  denied.push('second');
  await app.dictionaries.retrieve(1, app.state.generation, 0, 'n1');
  const work = app.dictionaries.get(1)[0]!.articles.n1; assert.equal(work?.status, 'error');
  if (work?.status === 'error') { assert.equal(work.failureKind, 'missing-access'); assert.deepEqual(work.providerIssues?.map(issue => issue.kind), ['network', 'missing-access']); }
  assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'second:resolve:candidate-1']);
});

test('article recovery stops at confirmed absence or unresolved mapping without querying another dictionary', async () => {
  for (const status of ['confirmed-absence', 'unresolved-mapping'] as const) {
    const app = await setup({ first: { retrieve: async () => { throw new RequestFailure('network', 'First article failed'); } },
      second: { resolve: async candidate => ({ ...resolution(candidate, 'second'), status, alternatives: [], evidence: 'Controlled absence evidence' }) } });
    await app.dictionaries.resolve(1, app.state.generation, 0);
    await app.dictionaries.retrieve(1, app.state.generation, 0, 'n1');
    const work = app.dictionaries.get(1)[0]!.resolution; assert.equal(work.status, 'complete');
    if (work.status === 'complete') { assert.equal(work.value.status, status); assert.equal(work.value.providerIssues?.length, 1); }
    assert.deepEqual(app.calls, ['first:resolve:candidate-1', 'first:article:n1', 'second:resolve:candidate-1']);
  }
});
