import { message } from '../i18n/messages.ts';
import type { UiMessage } from '../i18n/messages.ts';
export type ProviderRole = 'analysis' | 'dictionary';
export type ProviderOptionValue = string | boolean;
export type ProviderOption = { label: string } & (
  { type: 'boolean'; default: boolean } | { type: 'choice'; choices: readonly string[]; default: string }
);
export interface ProviderCapability {
  lookupLanguage: string;
  role: ProviderRole;
  explanationLanguages: readonly string[];
  inputNotations: readonly string[];
  structuralAnalysis?: boolean;
}
export interface ProviderDeclaration {
  id: string;
  name: string;
  capabilities: readonly ProviderCapability[];
  attribution: readonly string[];
  origins: readonly string[];
  options: Readonly<Record<string, ProviderOption>>;
  defaultEnabled: boolean;
}
export interface LanguageDeclaration { id: string; name: string; defaultExplanation: string; }
export interface ProviderCatalog { languages: readonly LanguageDeclaration[]; providers: readonly ProviderDeclaration[]; }
export interface ConfiguredProvider { id: string; enabled: boolean; options: Record<string, ProviderOptionValue>; }
export interface LanguageSettings {
  explanationLanguage: string;
  analysis: ConfiguredProvider[];
  dictionary: ConfiguredProvider[];
}
export interface SettingsDraft { lookupLanguage: string; languages: Record<string, LanguageSettings>; }
export interface Settings extends SettingsDraft { schema: 1; revision: string; }
export class ConfigurationError extends Error {
  readonly uiMessage: UiMessage;
  constructor(diagnostic: string, uiMessage: UiMessage = message('invalidSettings')) { super(diagnostic); this.name = 'ConfigurationError'; this.uiMessage = uiMessage; }
}
const roles: readonly ProviderRole[] = ['analysis', 'dictionary'];
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function providerCapability(catalog: ProviderCatalog, id: string, language: string, role: ProviderRole) {
  const provider = catalog.providers.find(item => item.id === id);
  const capability = provider?.capabilities.find(item => item.lookupLanguage === language && item.role === role);
  return provider && capability ? { provider, capability } : undefined;
}
export function defaultOptions(provider: ProviderDeclaration): Record<string, ProviderOptionValue> {
  return Object.fromEntries(Object.entries(provider.options).map(([name, declaration]) => [name, declaration.default]));
}
export function validOptions(provider: ProviderDeclaration, options: Record<string, ProviderOptionValue>): boolean {
  return Object.keys(options).length === Object.keys(provider.options).length && Object.entries(provider.options).every(([key, option]) =>
    option.type === 'boolean' ? typeof options[key] === 'boolean' : typeof options[key] === 'string' && option.choices.includes(options[key] as string));
}
export function defaultSettings(catalog: ProviderCatalog, revision: string): Settings {
  const languages: Record<string, LanguageSettings> = {};
  for (const language of catalog.languages) {
    const profile: LanguageSettings = { explanationLanguage: language.defaultExplanation, analysis: [], dictionary: [] };
    for (const role of roles) for (const provider of catalog.providers) {
      if (providerCapability(catalog, provider.id, language.id, role)) {
        profile[role].push({ id: provider.id, enabled: provider.defaultEnabled, options: defaultOptions(provider) });
      }
    }
    languages[language.id] = profile;
  }
  if (!languages.lat) throw new ConfigurationError('The integrated catalog must declare Latin.');
  return { schema: 1, revision, lookupLanguage: 'lat', languages };
}

/** Check persisted structure without substituting a now-unavailable preference. */
export function readSettings(value: unknown): Settings | undefined {
  if (!isRecord(value) || value.schema !== 1 || typeof value.revision !== 'string' || !value.revision ||
    typeof value.lookupLanguage !== 'string' || !isRecord(value.languages)) return;
  const languages: Record<string, LanguageSettings> = {};
  for (const [language, raw] of Object.entries(value.languages)) {
    if (!/^[a-z][a-z0-9-]*$/.test(language) || !isRecord(raw) || typeof raw.explanationLanguage !== 'string' || !raw.explanationLanguage) return;
    const profile: LanguageSettings = { explanationLanguage: raw.explanationLanguage, analysis: [], dictionary: [] };
    for (const role of roles) {
      const entries = raw[role];
      if (!Array.isArray(entries)) return;
      const seen = new Set<string>();
      for (const entry of entries) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || typeof entry.enabled !== 'boolean' ||
          !isRecord(entry.options) || seen.has(entry.id) || Object.values(entry.options).some(option => typeof option !== 'string' && typeof option !== 'boolean')) return;
        seen.add(entry.id);
        profile[role].push({ id: entry.id, enabled: entry.enabled, options: { ...entry.options } as Record<string, ProviderOptionValue> });
      }
    }
    languages[language] = profile;
  }
  if (!Object.hasOwn(languages, value.lookupLanguage)) return;
  return { schema: 1, revision: value.revision, lookupLanguage: value.lookupLanguage, languages };
}

export interface EligibleProvider { declaration: ProviderDeclaration; capability: ProviderCapability; configuration: ConfiguredProvider; }
export interface LookupRoutes {
  lookupLanguage: string;
  explanationLanguage: string;
  explanationChoices: string[];
  preferenceAvailable: boolean;
  allDisabled: boolean;
  analysisMode: 'explanations' | 'structural-only';
  analysis: EligibleProvider[];
  dictionary: EligibleProvider[];
}
export function lookupRoutes(settings: SettingsDraft, catalog: ProviderCatalog, language = settings.lookupLanguage): LookupRoutes {
  const profile = settings.languages[language];
  const eligible = (role: ProviderRole): EligibleProvider[] => (profile?.[role] ?? []).flatMap(configuration => {
    const declared = providerCapability(catalog, configuration.id, language, role);
    return configuration.enabled && declared && validOptions(declared.provider, configuration.options)
      ? [{ declaration: declared.provider, capability: declared.capability, configuration }] : [];
  });
  const analyzers = eligible('analysis'), dictionaries = eligible('dictionary');
  const explanationLanguage = profile?.explanationLanguage ?? '';
  const compatible = analyzers.filter(provider => provider.capability.explanationLanguages.includes(explanationLanguage));
  const explanationChoices = [...new Set([...analyzers, ...dictionaries].flatMap(provider => provider.capability.explanationLanguages))];
  return { lookupLanguage: language, explanationLanguage, explanationChoices,
    preferenceAvailable: explanationChoices.includes(explanationLanguage),
    allDisabled: !roles.some(role => profile?.[role].some(provider => provider.enabled)),
    analysisMode: compatible.length ? 'explanations' : 'structural-only',
    analysis: compatible.length ? compatible : analyzers.filter(provider => provider.capability.structuralAnalysis),
    dictionary: dictionaries.filter(provider => provider.capability.explanationLanguages.includes(explanationLanguage)) };
}

/** Save only explicit supported edits. Existing external capability loss is kept
 * by readSettings and surfaced by lookupRoutes, never silently repaired. */
export function editSettings(previous: Settings, value: unknown, catalog: ProviderCatalog, revision: string): Settings {
  if (!isRecord(value)) throw new ConfigurationError('Invalid settings.');
  const next = readSettings({ ...value, schema: 1, revision });
  if (!next || !catalog.languages.some(language => language.id === next.lookupLanguage)) throw new ConfigurationError('Choose a supported lookup language.', message('chooseLookup'));
  const knownLanguages = new Set(catalog.languages.map(language => language.id));
  if (Object.keys(next.languages).some(language => !knownLanguages.has(language)) ||
    catalog.languages.some(language => !next.languages[language.id])) throw new ConfigurationError('Settings must contain the integrated languages only.', message('integratedLanguages'));
  for (const [language, profile] of Object.entries(next.languages)) {
    // An unrelated edit must not silently replace an externally lost preference.
    if (JSON.stringify(profile) === JSON.stringify(previous.languages[language])) continue;
    for (const role of roles) for (const entry of profile[role]) {
      const declared = providerCapability(catalog, entry.id, language, role);
      if (!declared) {
        // A retired provider can be explicitly disabled or removed, never enabled.
        if (!entry.enabled && previous.languages[language]?.[role].some(saved => saved.id === entry.id)) continue;
        throw new ConfigurationError(`Provider ${entry.id} does not support ${role} for ${language}.`, message('providerUnsupported', { provider: entry.id, role, language }));
      }
      if (!validOptions(declared.provider, entry.options)) throw new ConfigurationError(`Choose only declared options for ${declared.provider.name}.`, message('declaredOptions', { provider: declared.provider.name }));
    }
    const routes = lookupRoutes(next, catalog, language);
    if (routes.allDisabled) {
      if (profile.explanationLanguage !== previous.languages[language]?.explanationLanguage) {
        throw new ConfigurationError('With every provider disabled, retain the saved explanation preference.', message('retainExplanation'));
      }
    } else if (!routes.preferenceAvailable) {
      throw new ConfigurationError(`Choose an explicitly supported replacement explanation language for ${language} before saving.`, message('replaceExplanation', { language }));
    }
  }
  const same = previous.lookupLanguage === next.lookupLanguage && JSON.stringify(previous.languages) === JSON.stringify(next.languages);
  return same ? previous : next;
}

export interface SettingsStorage { read(): Promise<unknown>; write(value: Settings): Promise<void>; }
/** Local settings are committed only after durable storage succeeds. Concurrent
 * edits use the revision they displayed, so one panel cannot overwrite another. */
export class ConfigurationStore {
  #catalog: ProviderCatalog;
  #storage: SettingsStorage;
  #revision: () => string;
  #current!: Settings;
  #ready: Promise<void>;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(catalog: ProviderCatalog, storage: SettingsStorage, revision: () => string = () => crypto.randomUUID()) {
    this.#catalog = catalog; this.#storage = storage; this.#revision = revision;
    this.#ready = (async () => {
      const saved = readSettings(await storage.read());
      const initial = saved ?? defaultSettings(catalog, revision());
      if (!saved) await storage.write(initial);
      this.#current = initial;
    })();
  }
  async get(): Promise<Settings> { await this.#ready; return structuredClone(this.#current); }
  save(draft: unknown, expectedRevision: string): Promise<Settings> {
    const edit = this.#tail.then(async () => {
      await this.#ready;
      if (this.#current.revision !== expectedRevision) throw new ConfigurationError('Settings changed elsewhere. Reload before saving.', message('configConflict'));
      const next = editSettings(this.#current, draft, this.#catalog, this.#revision());
      if (next !== this.#current) { await this.#storage.write(next); this.#current = next; }
      return structuredClone(this.#current);
    });
    this.#tail = edit.catch(() => {});
    return edit;
  }
}
