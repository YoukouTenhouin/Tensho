import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRouter } from '../src/core/provider-router.ts';
import { defaultSettings } from '../src/core/configuration.ts';
import type { ProviderCatalog, ProviderDeclaration, Settings } from '../src/core/configuration.ts';
import { LookupCoordinator } from '../src/core/lookup.ts';
import type { Analysis, Analyzer, Identity } from '../src/core/lookup.ts';
import { DictionaryCoordinator } from '../src/core/dictionary.ts';
import type { DictionaryProvider } from '../src/providers/latin-dictionary.ts';
import type { DictionaryResolution } from '../src/providers/latin-index.ts';
import { RequestFailure } from '../src/core/requests.ts';

function declaration(id: string, language: string, role: 'analysis' | 'dictionary', explanations: string[]): ProviderDeclaration {
  return { id, name: id, defaultEnabled: true, attribution: ['Controlled fixture'], origins: ['https://fixture.invalid/*'], options: {},
    capabilities: [{ lookupLanguage: language, role, explanationLanguages: explanations, inputNotations: ['controlled Unicode'], structuralAnalysis: role === 'analysis' }] };
}
const catalog: ProviderCatalog = {
  languages: [{ id: 'lat', name: 'Latin', defaultExplanation: 'en' }, { id: 'eng', name: 'English (controlled)', defaultExplanation: 'en' }],
  providers: [declaration('latin-en', 'lat', 'analysis', ['en']), declaration('latin-fr', 'lat', 'analysis', ['fr']),
    declaration('english-en', 'eng', 'analysis', ['en']), declaration('dictionary-fr', 'lat', 'dictionary', ['fr'])],
};
const candidate = { lemma: 'importo', stableId: null, interpretations: ['Part of speech: verb'], meanings: ['English provider-authored prose'] };
const analysis: Analysis = { provider: 'controlled', controlled: true, candidates: [candidate] };
const identity = (settings: Settings): Identity => ({ tabId: 1, frameId: 0, documentId: 'doc', topDocumentId: 'doc', configuration: settings.revision,
  lookupLanguage: settings.lookupLanguage, explanationLanguage: settings.languages[settings.lookupLanguage]!.explanationLanguage });
const resolution: DictionaryResolution = { status: 'alternatives', originalHeadword: 'importo', provenance: undefined, stableLemmaId: null,
  root: 'importo', alternatives: [{ dictionary: 'Controlled dictionary', entryId: 'n1', rows: [{ key: 'importo', entryId: 'n1', line: 1 }], correspondence: 'unverified' }], automaticSelection: null, exhaustive: false };
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

function setup(options: { settings?: Settings; analyze?: Analyzer['analyze']; declarations?: ProviderCatalog } = {}) {
  const declarations = options.declarations ?? catalog;
  let settings = options.settings ?? defaultSettings(declarations, 'one');
  const calls: { id: string; text: string; identity: Identity; invocation: Parameters<Analyzer['analyze']>[4] }[] = [];
  const analyzers: Record<string, Analyzer> = {};
  for (const provider of declarations.providers.filter(item => item.capabilities.some(capability => capability.role === 'analysis'))) {
    analyzers[provider.id] = { analyze: async (...args) => {
      calls.push({ id: provider.id, text: args[0], identity: args[1], invocation: args[4] });
      return options.analyze ? options.analyze(...args) : { ...analysis, provider: provider.id };
    } };
  }
  let dictionaryCalls = 0;
  const dictionary: DictionaryProvider = { resolve: async () => { dictionaryCalls++; return resolution; }, retrieve: async () => {
    dictionaryCalls++;
    return { dictionary: 'Controlled French dictionary', entryId: 'n1', paragraphs: ['French prose with Latin mālum and Greek ἅμα'], attribution: ['Credit'], links: [], sourceUrl: 'https://fixture.invalid/n1' };
  } };
  const router = new ProviderRouter({ catalog: declarations, settings: async () => structuredClone(settings), analyzers, dictionaries: { 'dictionary-fr': dictionary } });
  const lookup = new LookupCoordinator(router, () => {});
  const dictionaries = new DictionaryCoordinator(router, tab => lookup.get(tab), () => {}, async () => true);
  return { router, lookup, dictionaries, calls, settings: () => settings, replace: (next: Settings) => { settings = next; }, dictionaryCalls: () => dictionaryCalls };
}

test('production lookup routing isolates selected lookup language from identical spelling and explanation preferences', async () => {
  const app = setup();
  await app.lookup.lookup(identity(app.settings()), 'important');
  assert.deepEqual(app.calls.map(call => call.id), ['latin-en']);
  assert.equal(app.calls[0]!.identity.lookupLanguage, 'lat');
  const next = structuredClone(app.settings()); next.lookupLanguage = 'eng'; next.revision = 'two'; app.replace(next);
  await app.lookup.lookup(identity(next), 'important');
  assert.deepEqual(app.calls.map(call => call.id), ['latin-en', 'english-en']);
  assert.equal(app.lookup.get(1)?.identity.lookupLanguage, 'eng');
});

test('French-compatible analysis is selected before execution; failure and no-match never start the structural route', async () => {
  for (const failure of [false, true]) {
    const settings = defaultSettings(catalog, 'one'); settings.languages.lat!.explanationLanguage = 'fr';
    const app = setup({ settings, analyze: async () => {
      if (failure) throw new RequestFailure('network', 'Controlled failure');
      return { ...analysis, outcome: 'no-match', candidates: [] };
    } });
    await app.lookup.lookup(identity(settings), 'important');
    assert.deepEqual(app.calls.map(call => call.id), ['latin-fr']);
    assert.equal(app.calls[0]!.invocation?.explanationMode, 'explanations');
    assert.equal(app.lookup.get(1)?.status, failure ? 'error' : 'complete');
  }
});

test('structural-only route omits unavailable prose while keeping grammar and an eligible dictionary with embedded quotations', async () => {
  const settings = defaultSettings(catalog, 'one');
  settings.languages.lat!.explanationLanguage = 'fr'; settings.languages.lat!.analysis[1]!.enabled = false;
  const app = setup({ settings });
  await app.lookup.lookup(identity(settings), 'important');
  const state = app.lookup.get(1)!;
  assert.equal(state.status, 'complete'); if (state.status !== 'complete') assert.fail();
  assert.deepEqual(app.calls.map(call => call.id), ['latin-en']);
  assert.equal(app.calls[0]!.invocation?.explanationMode, 'structural-only');
  assert.deepEqual(state.analysis.candidates[0]!.meanings, []);
  assert.deepEqual(state.analysis.candidates[0]!.interpretations, ['Part of speech: verb']);
  assert.equal(state.analysis.explanationLanguage, null);
  assert.match(state.analysis.explanationNotice!, /unavailable.*fr/);
  assert.deepEqual(candidate.meanings, ['English provider-authored prose'], 'adapter-owned result is not mutated');
  await app.dictionaries.resolve(1, state.generation, 0);
  await app.dictionaries.retrieve(1, state.generation, 0, 'n1');
  const article = app.dictionaries.get(1)[0]!.articles.n1;
  assert.equal(article?.status, 'complete');
  if (article?.status === 'complete') assert.match(article.value.paragraphs[0]!, /mālum and Greek ἅμα/);
  assert.equal(app.lookup.get(1), state);
});

test('dictionary-unavailable and all-disabled configurations remain explicit and send no ineligible provider calls', async () => {
  const app = setup();
  await app.lookup.lookup(identity(app.settings()), 'important');
  const state = app.lookup.get(1)!;
  await app.dictionaries.resolve(1, state.generation, 0);
  assert.equal(app.dictionaries.get(1)[0]!.resolution.status, 'unavailable'); assert.equal(app.dictionaryCalls(), 0);
  assert.equal(app.lookup.get(1), state);
  const disabled = structuredClone(app.settings()); disabled.revision = 'two';
  for (const role of ['analysis', 'dictionary'] as const) disabled.languages.lat![role].forEach(provider => { provider.enabled = false; });
  app.replace(disabled);
  await app.lookup.lookup(identity(disabled), 'important');
  assert.equal(app.lookup.get(1)?.status, 'unavailable'); assert.equal(app.calls.length, 1);
});

test('declared provider options reach the selected adapter without exposing operational URLs or limits', async () => {
  const declarations = structuredClone(catalog);
  const first = declarations.providers[0]!;
  first.options = { mode: { label: 'Mode', type: 'choice', choices: ['brief', 'full'], default: 'brief' } };
  const settings = defaultSettings(declarations, 'one'); settings.languages.lat!.analysis[0]!.options.mode = 'full';
  const app = setup({ declarations, settings });
  await app.lookup.lookup(identity(settings), 'important');
  assert.deepEqual(app.calls[0]!.invocation, { explanationMode: 'explanations', options: { mode: 'full' } });
});

test('new configuration identity rejects old provider completion through production coordination', async () => {
  const pending: ((result: Analysis) => void)[] = [];
  const app = setup({ analyze: () => new Promise(resolve => pending.push(resolve)) });
  const old = app.lookup.lookup(identity(app.settings()), 'important'); await turn();
  const changed = structuredClone(app.settings()); changed.revision = 'two'; changed.languages.lat!.explanationLanguage = 'fr'; app.replace(changed);
  const current = app.lookup.lookup(identity(changed), 'important'); await turn();
  pending[1]!({ ...analysis, provider: 'current' }); await current;
  pending[0]!({ ...analysis, provider: 'stale' }); await old;
  const state = app.lookup.get(1)!; assert.equal(state.status, 'complete');
  if (state.status === 'complete') assert.equal(state.analysis.provider, 'current');
  assert.equal(state.identity.configuration, 'two'); assert.equal(state.identity.explanationLanguage, 'fr');
});

test('saving settings refreshes visible chosen passage words, retains unchosen passages, and invalidates inactive output', async () => {
  const app = setup();
  const original = identity(app.settings());
  await app.lookup.lookup(original, 'important mālum');
  const passageId = app.lookup.get(1)!.passage!.id;
  await app.lookup.selectWord(1, passageId, 1);
  await app.lookup.lookup({ ...original, tabId: 2 }, 'important');
  await app.lookup.lookup({ ...original, tabId: 3 }, 'cano mālum');
  const callsBefore = app.calls.length;
  const changed = structuredClone(app.settings()); changed.revision = 'two'; changed.languages.lat!.explanationLanguage = 'fr'; app.replace(changed);
  app.lookup.reconfigure(identity(changed), [1, 3]);
  assert.equal(app.lookup.get(1)?.status, 'loading');
  assert.equal(app.lookup.get(2)?.status, 'notice');
  assert.equal(app.lookup.get(3)?.status, 'notice');
  await turn();
  assert.deepEqual(app.calls.slice(callsBefore).map(call => [call.id, call.text]), [['latin-fr', 'mālum']]);
  const selected = app.lookup.get(1)!;
  assert.equal(selected.status, 'complete');
  assert.equal(selected.identity.configuration, 'two');
  assert.deepEqual(selected.passage, { id: passageId, original: 'important mālum',
    words: [{ text: 'important', start: 0, end: 9 }, { text: 'mālum', start: 10, end: 15 }], selectedIndex: 1 });
  assert.equal(app.lookup.get(2)?.identity.explanationLanguage, 'fr');
  assert.equal(app.lookup.get(3)?.passage?.original, 'cano mālum');
});

test('configuration refresh cancels pending capture and late analysis without replacing the refreshed result', async () => {
  const pending: ((result: Analysis) => void)[] = [];
  const app = setup({ analyze: () => new Promise(resolve => pending.push(resolve)) });
  const old = app.lookup.lookup(identity(app.settings()), 'important'); await turn();
  const capture = app.lookup.begin(2);
  const changed = structuredClone(app.settings()); changed.revision = 'two'; changed.languages.lat!.explanationLanguage = 'fr'; app.replace(changed);
  app.lookup.reconfigure(identity(changed), [1]); await turn();
  assert.equal(capture.current(), false);
  await capture.lookup({ ...identity(changed), tabId: 2 }, 'cano');
  assert.equal(app.lookup.get(2), undefined);
  pending[1]!({ ...analysis, provider: 'fresh' }); await turn();
  pending[0]!({ ...analysis, provider: 'obsolete' }); await old;
  const result = app.lookup.get(1)!;
  assert.equal(result.status, 'complete');
  if (result.status === 'complete') assert.equal(result.analysis.provider, 'fresh');
  assert.equal(result.identity.configuration, 'two');
});
