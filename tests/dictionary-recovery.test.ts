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
