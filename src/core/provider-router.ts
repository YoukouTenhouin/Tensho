import type { Analysis, Analyzer, Identity } from './lookup.ts';
import type { ProviderCatalog, Settings } from './configuration.ts';
import { lookupRoutes } from './configuration.ts';
import { RequestFailure } from './requests.ts';
import { runProviderChain } from './provider-chain.ts';
import type { DictionaryProvider } from '../providers/latin-dictionary.ts';
import type { DictionaryResolution } from '../providers/latin-index.ts';
import type { DictionaryArticle } from '../providers/latin-article.ts';

/** Preselect language and explanation eligibility before ordered recovery. */
export class ProviderRouter implements Analyzer, DictionaryProvider {
  #catalog: ProviderCatalog;
  #permitted: (origins: readonly string[]) => Promise<boolean>;
  #settings: () => Promise<Settings>;
  #analyzers: Readonly<Record<string, Analyzer>>;
  #dictionaries: Readonly<Record<string, DictionaryProvider>>;
  constructor(dependencies: { catalog: ProviderCatalog; settings(): Promise<Settings>; permitted(origins: readonly string[]): Promise<boolean>;
    analyzers: Readonly<Record<string, Analyzer>>; dictionaries: Readonly<Record<string, DictionaryProvider>> }) {
    this.#permitted = dependencies.permitted;
    this.#catalog = dependencies.catalog; this.#settings = dependencies.settings;
    this.#analyzers = dependencies.analyzers; this.#dictionaries = dependencies.dictionaries;
  }
  async #routes(identity: Identity, signal: AbortSignal) {
    const settings = await this.#settings();
    signal.throwIfAborted();
    if (settings.revision !== identity.configuration || settings.lookupLanguage !== identity.lookupLanguage ||
      settings.languages[identity.lookupLanguage]?.explanationLanguage !== identity.explanationLanguage) {
      throw new RequestFailure('cancelled', 'Lookup settings changed. Use the current settings.');
    }
    return lookupRoutes(settings, this.#catalog);
  }
  async analyze(text: string, identity: Identity, signal: AbortSignal, deadline: number): Promise<Analysis> {
    const routes = await this.#routes(identity, signal);
    if (!routes.analysis.length) throw new RequestFailure('unconfigured', routes.allDisabled
      ? 'No providers are enabled for this lookup language. Enable a supported provider in settings.'
      : 'Analysis is unavailable for this configuration. Enable a supported analyzer in settings.');
    const recovered = await runProviderChain({ providers: routes.analysis, operation: 'analysis', signal, deadline,
      permitted: this.#permitted, current: active => this.#routes(identity, active),
      supports: selected => this.#analyzers[selected.declaration.id]?.supportsInput?.(text, identity) ?? true,
      execute: (selected, active) => {
        const analyzer = this.#analyzers[selected.declaration.id];
        if (!analyzer) throw new RequestFailure('unconfigured', 'The configured analyzer is not integrated.');
        return analyzer.analyze(text, identity, active, deadline,
          { explanationMode: routes.analysisMode, options: { ...selected.configuration.options } });
      } });
    const result = recovered.issues.length ? { ...recovered.value, providerIssues: recovered.issues } : recovered.value;
    if (routes.analysisMode === 'explanations') return result;
    return { ...result, explanationLanguage: null,
      explanationNotice: `Short meanings are unavailable for explanation preference ${identity.explanationLanguage}. Lemmas and grammatical interpretations are retained.`,
      candidates: result.candidates.map(candidate => ({ ...candidate, meanings: [] })) };
  }
  async resolve(candidate: Analysis['candidates'][number], identity: Identity, signal: AbortSignal, deadline: number): Promise<DictionaryResolution> {
    const routes = await this.#routes(identity, signal);
    const selected = routes.dictionary[0];
    const dictionary = selected && this.#dictionaries[selected.declaration.id];
    if (!selected || !dictionary) throw new RequestFailure('unsupported-explanation', 'Dictionary entries are unavailable for the selected explanation preference and enabled providers.');
    const resolution = await dictionary.resolve(candidate, identity, signal, deadline, { ...selected.configuration.options });
    await this.#routes(identity, signal);
    return { ...resolution, providerId: selected.declaration.id };
  }
  async retrieve(resolution: DictionaryResolution, entryId: string, identity: Identity, signal: AbortSignal, deadline: number): Promise<DictionaryArticle> {
    const routes = await this.#routes(identity, signal);
    const selected = routes.dictionary.find(provider => provider.declaration.id === resolution.providerId);
    const dictionary = selected && this.#dictionaries[selected.declaration.id];
    if (!selected || !dictionary) throw new RequestFailure('unsupported-explanation', 'This dictionary alternative is unavailable under the current settings.');
    const article = await dictionary.retrieve(resolution, entryId, identity, signal, deadline, { ...selected.configuration.options });
    await this.#routes(identity, signal);
    return article;
  }
}
