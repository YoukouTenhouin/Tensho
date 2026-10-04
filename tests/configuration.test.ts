import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigurationStore, ConfigurationError, defaultSettings, editSettings, lookupRoutes, readSettings } from '../src/core/configuration.ts';
import type { ProviderCatalog, ProviderDeclaration, Settings } from '../src/core/configuration.ts';
import { providerCatalog } from '../src/providers/catalog.ts';

function provider(id: string, role: 'analysis' | 'dictionary', explanations: string[], structuralAnalysis = false): ProviderDeclaration {
  return { id, name: id, defaultEnabled: true, origins: ['https://fixture.invalid/*'], attribution: ['Controlled capability'],
    capabilities: [{ lookupLanguage: 'lat', role, explanationLanguages: explanations, inputNotations: ['Latin'], structuralAnalysis }], options: {} };
}
const catalog: ProviderCatalog = { languages: providerCatalog.languages, providers: [
  provider('english', 'analysis', ['en'], true), provider('french', 'analysis', ['fr'], true),
  provider('both', 'analysis', ['en', 'fr'], true), provider('dictionary-en', 'dictionary', ['en']),
  provider('dictionary-fr', 'dictionary', ['fr']),
] };
const ids = (providers: ReturnType<typeof lookupRoutes>['analysis']) => providers.map(item => item.declaration.id);

test('shipping defaults are Latin/English with independent roles and no planned Sanskrit integration', () => {
  const settings = defaultSettings(providerCatalog, 'initial');
  assert.equal(settings.lookupLanguage, 'lat'); assert.equal(settings.languages.lat!.explanationLanguage, 'en');
  const routes = lookupRoutes(settings, providerCatalog);
  assert.deepEqual(ids(routes.analysis), ['alpheios-whitakerLat']); assert.deepEqual(ids(routes.dictionary), ['alpheios-ls']);
  assert.equal(routes.analysisMode, 'explanations'); assert.equal(routes.preferenceAvailable, true);
  const sanskrit = lookupRoutes(settings, providerCatalog, 'san');
  assert.equal(sanskrit.allDisabled, true); assert.deepEqual(sanskrit.analysis, []); assert.deepEqual(sanskrit.dictionary, []);
  for (const declaration of providerCatalog.providers) {
    assert.ok(declaration.attribution.length && declaration.origins.length && declaration.capabilities.every(capability => capability.inputNotations.length));
    assert.deepEqual(declaration.options, {});
  }
});

test('preferred explanation route filters analyzers in configured order and preselects structural-only only when needed', () => {
  const settings = defaultSettings(catalog, 'a');
  const profile = settings.languages.lat!;
  profile.explanationLanguage = 'fr';
  profile.analysis.reverse();
  let routes = lookupRoutes(settings, catalog);
  assert.deepEqual(ids(routes.analysis), ['both', 'french']); assert.equal(routes.analysisMode, 'explanations');
  assert.deepEqual(ids(routes.dictionary), ['dictionary-fr']);
  profile.analysis.forEach(item => { item.enabled = item.id === 'english'; });
  routes = lookupRoutes(settings, catalog);
  assert.deepEqual(ids(routes.analysis), ['english']); assert.equal(routes.analysisMode, 'structural-only');
  assert.equal(routes.preferenceAvailable, true, 'dictionary alone can support the explanation preference');
  profile.dictionary.forEach(item => { item.enabled = item.id === 'dictionary-en'; });
  routes = lookupRoutes(settings, catalog);
  assert.equal(routes.preferenceAvailable, false); assert.deepEqual(routes.dictionary, []);
  assert.deepEqual(ids(routes.analysis), ['english']);
});

test('edits require an explicit replacement when enabled roles lose support, but all-disabled preserves the preference', () => {
  const previous = defaultSettings(catalog, 'a');
  const draft = structuredClone(previous);
  for (const role of ['analysis', 'dictionary'] as const) draft.languages.lat![role].forEach(item => { item.enabled = item.id.endsWith('fr') || item.id === 'french'; });
  assert.throws(() => editSettings(previous, draft, catalog, 'b'), /explicitly supported replacement/);
  draft.languages.lat!.explanationLanguage = 'fr';
  const french = editSettings(previous, draft, catalog, 'b');
  assert.equal(french.revision, 'b'); assert.equal(lookupRoutes(french, catalog).preferenceAvailable, true);
  const disabled = structuredClone(french);
  for (const role of ['analysis', 'dictionary'] as const) disabled.languages.lat![role].forEach(item => { item.enabled = false; });
  assert.equal(editSettings(french, disabled, catalog, 'c').languages.lat!.explanationLanguage, 'fr');
  disabled.languages.lat!.explanationLanguage = 'de';
  assert.throws(() => editSettings(french, disabled, catalog, 'c'), /retain the saved explanation preference/);
});

test('external capability loss preserves the saved preference and allows unrelated language selection', () => {
  const previous = defaultSettings(catalog, 'a'); previous.languages.lat!.explanationLanguage = 'fr';
  const changed = { ...catalog, providers: catalog.providers.filter(item => !['french', 'both', 'dictionary-fr'].includes(item.id)) };
  const restored = readSettings(JSON.parse(JSON.stringify(previous)))!;
  assert.equal(restored.languages.lat!.explanationLanguage, 'fr');
  assert.equal(lookupRoutes(restored, changed).preferenceAvailable, false);
  const draft = structuredClone(restored); draft.lookupLanguage = 'san';
  assert.equal(editSettings(restored, draft, changed, 'b').languages.lat!.explanationLanguage, 'fr');
});

test('only declared options and role/language combinations are accepted; order and options establish new identity', () => {
  const optionProvider: ProviderDeclaration = { ...provider('options', 'analysis', ['en'], true), options: {
    detail: { label: 'Detail', type: 'choice', choices: ['brief', 'full'], default: 'brief' },
    variants: { label: 'Variants', type: 'boolean', default: false },
  } };
  const declarations = { ...catalog, providers: [...catalog.providers, optionProvider] };
  const previous = defaultSettings(declarations, 'a');
  const draft = structuredClone(previous);
  draft.languages.lat!.analysis.reverse();
  draft.languages.lat!.analysis[0]!.options = { detail: 'full', variants: true };
  const saved = editSettings(previous, draft, declarations, 'b');
  assert.equal(saved.revision, 'b'); assert.equal(saved.languages.lat!.analysis[0]!.id, 'options');
  assert.equal(editSettings(saved, structuredClone(saved), declarations, 'c').revision, 'b');
  draft.languages.lat!.analysis[0]!.options.endpoint = 'https://attacker.invalid';
  assert.throws(() => editSettings(previous, draft, declarations, 'c'), /declared options/);
  draft.languages.lat!.analysis[0]!.options = { detail: 'invented', variants: true };
  assert.throws(() => editSettings(previous, draft, declarations, 'c'), /declared options/);
  const wrongRole = structuredClone(previous); wrongRole.languages.lat!.dictionary.push(wrongRole.languages.lat!.analysis[0]!);
  assert.throws(() => editSettings(previous, wrongRole, declarations, 'c'), /does not support dictionary/);
});

test('configuration storage persists explicit choices, survives restart, and rejects stale or failed saves', async () => {
  let persisted: unknown, fail = false, serial = 0;
  const storage = { read: async () => persisted, write: async (value: Settings) => { if (fail) throw new Error('Storage failed'); persisted = structuredClone(value); } };
  const store = new ConfigurationStore(catalog, storage, () => `revision-${++serial}`);
  const initial = await store.get();
  const draft = structuredClone(initial); draft.lookupLanguage = 'san'; draft.languages.lat!.explanationLanguage = 'fr';
  const saved = await store.save(draft, initial.revision);
  const restarted = new ConfigurationStore(catalog, storage);
  assert.deepEqual(await restarted.get(), saved);
  assert.equal(saved.lookupLanguage, 'san'); assert.equal(saved.languages.lat!.explanationLanguage, 'fr');
  await assert.rejects(store.save(initial, initial.revision), ConfigurationError);
  const next = structuredClone(saved); next.lookupLanguage = 'lat'; fail = true;
  await assert.rejects(store.save(next, saved.revision), /Storage failed/);
  assert.deepEqual(await store.get(), saved);
  fail = false;
  const [first, second] = await Promise.allSettled([store.save(next, saved.revision), store.save(initial, saved.revision)]);
  assert.equal(first.status, 'fulfilled'); assert.equal(second.status, 'rejected');
});
