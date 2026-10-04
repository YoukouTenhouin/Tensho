export interface Identity {
  tabId: number;
  frameId: number;
  documentId: string;
  topDocumentId: string;
  configuration: string;
  lookupLanguage: string;
  explanationLanguage: string;
}
export interface Analysis {
  provider: string;
  controlled: boolean;
  candidates: { lemma: string; interpretations: string[]; meanings: string[]; stableId: string | null }[];
}
export type State = { generation: number; identity: Identity; text: string } & (
  { status: 'loading' } | { status: 'complete'; analysis: Analysis } |
  { status: 'notice' | 'error'; message: string }
);
export interface Analyzer {
  analyze(text: string, identity: Identity, signal: AbortSignal): Promise<Analysis>;
}
/** Browser-independent production entry point shared by every lookup action. */
export class LookupCoordinator {
  #states = new Map<number, State>();
  #pending = new Map<number, AbortController>();
  #generation = 0;
  #analyzer: Analyzer;
  #publish: (state: State | undefined, tabId: number) => void;
  constructor(analyzer: Analyzer, publish: (state: State | undefined, tabId: number) => void) {
    this.#analyzer = analyzer;
    this.#publish = publish;
  }
  get(tabId: number): State | undefined { return this.#states.get(tabId); }
  clear(tabId: number): void {
    this.#pending.get(tabId)?.abort();
    this.#pending.delete(tabId);
    this.#states.delete(tabId);
    this.#publish(undefined, tabId);
  }
  notice(identity: Identity, text: string, message: string): void {
    this.#pending.get(identity.tabId)?.abort();
    this.#pending.delete(identity.tabId);
    this.#set({ identity: { ...identity }, text, generation: ++this.#generation, status: 'notice', message });
  }
  #set(state: State): void {
    this.#states.set(state.identity.tabId, state);
    this.#publish(state, state.identity.tabId);
  }
  async lookup(identity: Identity, input: string): Promise<void> {
    const text = input.trim();
    if (!text) return this.notice(identity, '', 'Select text on an ordinary webpage or enter a word here.');
    if ([...text].length > 2000) return this.notice(identity, '', 'Selection exceeds 2,000 Unicode code points. Select less text; nothing was sent.');
    if (/\s/u.test(text)) return this.notice(identity, text, 'Passage retained. Individual-word study arrives in the passage slice; no analysis was requested.');
    if ([...text].length > 128) return this.notice(identity, text, 'A word must be at most 128 Unicode code points. Nothing was sent.');
    this.#pending.get(identity.tabId)?.abort();
    const abort = new AbortController();
    this.#pending.set(identity.tabId, abort);
    const base = { identity: { ...identity }, text, generation: ++this.#generation };
    this.#set({ ...base, status: 'loading' });
    const current = () => this.#states.get(identity.tabId)?.generation === base.generation && !abort.signal.aborted;
    try {
      const analysis = await this.#analyzer.analyze(text, base.identity, abort.signal);
      if (current()) this.#set({ ...base, status: 'complete', analysis });
    } catch (error) {
      if (current()) this.#set({ ...base, status: 'error', message: error instanceof Error ? error.message : 'Analysis failed. Try again.' });
    } finally {
      if (this.#pending.get(identity.tabId) === abort) this.#pending.delete(identity.tabId);
    }
  }
}
