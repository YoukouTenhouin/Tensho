import { RequestFailure, requestLimits } from './requests.ts';
import { prepareSelection } from './input.ts';
import type { OfferedWord } from './input.ts';
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
  outcome?: 'usable' | 'no-match' | 'missing-information';
  attribution?: string[];
  excludedForeignRecords?: number;
  candidates: { lemma: string | null; interpretations: string[]; meanings: string[]; stableId: string | null;
    grammar?: Record<string, unknown>[]; lemmaFeatures?: Record<string, unknown>;
    provenance?: { provider: string; bodyReference: string | null; annotationIndex: number; bodyIndex: number; entryIndex: number };
    missing?: string[] }[];
}
export interface Passage { id: number; original: string; words: OfferedWord[]; selectedIndex?: number; }
export type State = { generation: number; identity: Identity; text: string; passage?: Passage } & (
  { status: 'loading' } | { status: 'complete'; analysis: Analysis } |
  { status: 'notice' | 'error'; message: string; failureKind?: RequestFailure['kind'] }
);
export interface Analyzer {
  analyze(text: string, identity: Identity, signal: AbortSignal, deadline: number): Promise<Analysis>;
}
export interface LookupRequest {
  current(): boolean;
  lookup(identity: Identity, input: string): Promise<void>;
  selectWord(identity: Identity, passageId: number, wordIndex: number): Promise<void>;
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
  #sourceIsCurrent: (identity: Identity) => Promise<boolean>;
  #invalidate: (tabId: number) => void;
  constructor(analyzer: Analyzer, publish: (state: State | undefined, tabId: number) => void,
    sourceIsCurrent: (identity: Identity) => Promise<boolean> = async () => true,
    invalidate: (tabId: number) => void = () => {}) {
    this.#analyzer = analyzer;
    this.#publish = publish;
    this.#sourceIsCurrent = sourceIsCurrent;
    this.#invalidate = invalidate;
  }
  get(tabId: number): State | undefined { return this.#states.get(tabId); }
  clear(tabId: number): void {
    this.#invalidate(tabId);
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
    this.#invalidate(tabId);
    this.#pending.get(tabId)?.abort();
    this.#pending.delete(tabId);
    const deadline = performance.now() + requestLimits.actionMs;
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
          await this.#lookup(identity, input, request, deadline);
        }
      },
      selectWord: async (identity, passageId, wordIndex) => {
        if (identity.tabId !== tabId) throw new Error('Lookup source belongs to another tab.');
        const previous = this.#states.get(tabId);
        const passage = previous?.passage;
        if (!current() || !passage || passage.id !== passageId || !Number.isInteger(wordIndex)) return;
        const word = passage.words[wordIndex];
        if (!word || !previous || Object.keys(identity).some(key => identity[key as keyof Identity] !== previous.identity[key as keyof Identity])) return;
        scope.frameId = identity.frameId;
        await this.#lookup(identity, word.text, request, deadline, { ...passage, selectedIndex: wordIndex });
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
  selectWord(tabId: number, passageId: number, wordIndex: number): Promise<void> {
    const state = this.#states.get(tabId);
    if (!state?.passage || state.passage.id !== passageId || !Number.isInteger(wordIndex) || !state.passage.words[wordIndex]) return Promise.resolve();
    return this.begin(tabId, state.identity.frameId).selectWord(state.identity, passageId, wordIndex);
  }
  #set(state: State): void {
    this.#states.set(state.identity.tabId, state);
    this.#publish(state, state.identity.tabId);
  }
  async #lookup(identity: Identity, input: string, request: LookupRequest, deadline: number, passage?: Passage): Promise<void> {
    const prepared = prepareSelection(input);
    if ('error' in prepared) return request.notice(identity, input, prepared.error);
    if (prepared.words.length > 1) {
      const generation = ++this.#generation;
      this.#set({ identity: { ...identity }, text: input, generation, status: 'notice',
        passage: { id: generation, original: input, words: prepared.words }, message: 'Passage retained. Choose one word to look up; nothing has been sent.' });
      return;
    }
    const text = prepared.words[0]!.text;
    this.#pending.get(identity.tabId)?.abort();
    const abort = new AbortController();
    this.#pending.set(identity.tabId, abort);
    const base = { identity: { ...identity }, text: input, generation: ++this.#generation, ...(passage ? { passage } : {}) };
    this.#set({ ...base, status: 'loading' });
    const current = () => request.current() && this.#states.get(identity.tabId)?.generation === base.generation && !abort.signal.aborted;
    try {
      const analysis = await this.#analyzer.analyze(text, base.identity, abort.signal, deadline);
      if (!current()) return;
      const validSource = await this.#sourceIsCurrent(base.identity);
      if (!current()) return;
      if (validSource) this.#set({ ...base, status: 'complete', analysis });
      else this.clear(identity.tabId);
    } catch (error) {
      if (current()) this.#set({ ...base, status: 'error', failureKind: error instanceof RequestFailure ? error.kind : undefined, message: error instanceof Error ? error.message : 'Analysis failed. Try again.' });
    } finally {
      if (this.#pending.get(identity.tabId) === abort) this.#pending.delete(identity.tabId);
    }
  }
}
