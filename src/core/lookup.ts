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
export interface LookupRequest {
  current(): boolean;
  lookup(identity: Identity, input: string): Promise<void>;
  notice(identity: Identity, text: string, message: string): void;
}
/** Browser-independent production entry point shared by every lookup action. */
export class LookupCoordinator {
  #states = new Map<number, State>();
  #pending = new Map<number, AbortController>();
  #generation = 0;
  #requests = new Map<number, { token: symbol; frameId: number | undefined }>();
  #analyzer: Analyzer;
  #publish: (state: State | undefined, tabId: number) => void;
  constructor(analyzer: Analyzer, publish: (state: State | undefined, tabId: number) => void) {
    this.#analyzer = analyzer;
    this.#publish = publish;
  }
  get(tabId: number): State | undefined { return this.#states.get(tabId); }
  clear(tabId: number): void {
    this.#requests.delete(tabId);
    this.#pending.get(tabId)?.abort();
    this.#pending.delete(tabId);
    this.#states.delete(tabId);
    this.#publish(undefined, tabId);
  }
  navigate(tabId: number, frameId: number): void {
    const request = this.#requests.get(tabId);
    if (frameId === 0 || (request && (request.frameId === undefined || request.frameId === frameId)) ||
        this.#states.get(tabId)?.identity.frameId === frameId) this.clear(tabId);
  }
  /** Reserve order before asynchronous browser identity or selection capture. */
  begin(tabId: number, frameId?: number): LookupRequest {
    this.#pending.get(tabId)?.abort();
    this.#pending.delete(tabId);
    const token = Symbol();
    const scope = { token, frameId };
    this.#requests.set(tabId, scope);
    const current = () => this.#requests.get(tabId)?.token === token;
    const request: LookupRequest = {
      current,
      lookup: async (identity, input) => {
        if (identity.tabId !== tabId) throw new Error('Lookup source belongs to another tab.');
        if (current()) {
          scope.frameId = identity.frameId;
          await this.#lookup(identity, input, request);
        }
      },
      notice: (identity, text, message) => {
        if (identity.tabId !== tabId) throw new Error('Lookup source belongs to another tab.');
        if (current()) {
          this.#pending.get(tabId)?.abort();
          this.#pending.delete(tabId);
          this.#set({ identity: { ...identity }, text, generation: ++this.#generation, status: 'notice', message });
        }
      },
    };
    return request;
  }
  notice(identity: Identity, text: string, message: string): void {
    this.begin(identity.tabId).notice(identity, text, message);
  }
  lookup(identity: Identity, input: string): Promise<void> {
    return this.begin(identity.tabId).lookup(identity, input);
  }
  #set(state: State): void {
    this.#states.set(state.identity.tabId, state);
    this.#publish(state, state.identity.tabId);
  }
  async #lookup(identity: Identity, input: string, request: LookupRequest): Promise<void> {
    const text = input.trim();
    if (!text) return request.notice(identity, '', 'Select text on an ordinary webpage or enter a word here.');
    if ([...text].length > 4096) return request.notice(identity, '', 'Selection exceeds 4,096 Unicode code points. Select less text; nothing was sent.');
    if (!/[\p{L}\p{N}]/u.test(text)) return request.notice(identity, text, 'Enter a word containing letters or numbers. Nothing was sent.');
    if (/\s/u.test(text)) return request.notice(identity, text, 'Passage retained. Individual-word study arrives in the passage slice; no analysis was requested.');
    if ([...text].length > 256) return request.notice(identity, text, 'A word must be at most 256 Unicode code points. Nothing was sent.');
    this.#pending.get(identity.tabId)?.abort();
    const abort = new AbortController();
    this.#pending.set(identity.tabId, abort);
    const base = { identity: { ...identity }, text, generation: ++this.#generation };
    this.#set({ ...base, status: 'loading' });
    const current = () => request.current() && this.#states.get(identity.tabId)?.generation === base.generation && !abort.signal.aborted;
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
