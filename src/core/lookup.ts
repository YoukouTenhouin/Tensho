import { RequestFailure, requestLimits, capabilityUnavailable } from './requests.ts';
import type { ProviderIssue } from './requests.ts';
import type { ProviderOptionValue } from './configuration.ts';
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
export function sameIdentity(left: Identity, right: Identity): boolean {
  return left.tabId === right.tabId && left.frameId === right.frameId && left.documentId === right.documentId &&
    left.topDocumentId === right.topDocumentId && left.configuration === right.configuration &&
    left.lookupLanguage === right.lookupLanguage && left.explanationLanguage === right.explanationLanguage;
}
export interface Analysis {
  provider: string;
  controlled: boolean;
  outcome?: 'usable' | 'no-match' | 'missing-information';
  attribution?: string[];
  excludedForeignRecords?: number;
  explanationLanguage?: string | null;
  explanationNotice?: string;
  providerIssues?: ProviderIssue[];
  candidates: { lemma: string | null; interpretations: string[]; meanings: string[]; stableId: string | null;
    grammar?: Record<string, unknown>[]; lemmaFeatures?: Record<string, unknown>;
    provenance?: { provider: string; bodyReference: string | null; annotationIndex: number; bodyIndex: number; entryIndex: number };
    missing?: string[] }[];
}
export interface Passage { id: number; original: string; words: OfferedWord[]; selectedIndex?: number; }
export type State = { generation: number; identity: Identity; text: string; passage?: Passage } & (
  { status: 'loading' } | { status: 'complete'; analysis: Analysis } |
  { status: 'notice' | 'error' | 'unavailable'; message: string; refreshOnView?: true; failureKind?: RequestFailure['kind']; providerIssues?: ProviderIssue[] }
);
export interface AnalysisInvocation { explanationMode: 'explanations' | 'structural-only'; options: Record<string, ProviderOptionValue>; }
export interface Analyzer {
  supportsInput?(text: string, identity: Identity): boolean;
  // Interpretations contain application-authored English grammar labels, never
  // provider prose repurposed to bypass explanation-language eligibility.
  analyze(text: string, identity: Identity, signal: AbortSignal, deadline: number, invocation?: AnalysisInvocation): Promise<Analysis>;
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
  #wordChoices = new Map<number, symbol>();
  #restorationClosed = new Set<number>();
  #analyzer: Analyzer;
  #publish: (state: State | undefined, tabId: number) => void;
  #sourceIsCurrent: (identity: Identity) => Promise<boolean>;
  #invalidate: (tabId: number, preserve?: boolean) => void;
  #prepareLookup: ((identity: Identity, current: () => boolean) => Promise<boolean>) | undefined;
  constructor(analyzer: Analyzer, publish: (state: State | undefined, tabId: number) => void,
    sourceIsCurrent: (identity: Identity) => Promise<boolean> = async () => true,
    invalidate: (tabId: number, preserve?: boolean) => void = () => {},
    prepareLookup?: (identity: Identity, current: () => boolean) => Promise<boolean>) {
    this.#analyzer = analyzer;
    this.#publish = publish;
    this.#sourceIsCurrent = sourceIsCurrent;
    this.#invalidate = invalidate;
    this.#prepareLookup = prepareLookup;
  }
  get(tabId: number): State | undefined { return this.#states.get(tabId); }
  /** Capture the current intent, including actions still acquiring their source. */
  guard(tabId: number): () => boolean {
    const token = this.#requests.get(tabId)?.token;
    return () => this.#requests.get(tabId)?.token === token;
  }
  retainAfterRefusal(tabId: number): void {
    const state = this.#states.get(tabId);
    if (state?.status === 'loading' && !this.#pending.has(tabId)) this.#set({ ...state, status: 'error', failureKind: 'interrupted',
      message: 'The previous lookup was interrupted. Retry explicitly to resume.' });
  }
  /** Hydrate once without requests. A newly reserved browser action always wins
   * over slower session loading, even before it has captured its source. */
  restore(saved: State): boolean {
    const tabId = saved.identity.tabId;
    if (this.#restorationClosed.has(tabId) || this.#requests.has(tabId) || this.#states.has(tabId)) return false;
    this.#restorationClosed.add(tabId);
    const state = structuredClone(saved);
    this.#generation = Math.max(this.#generation, state.generation, state.passage?.id ?? 0);
    this.#requests.set(tabId, { token: Symbol(), frameId: state.identity.frameId });
    this.#set(state.status === 'loading' ? { ...state, status: 'error', failureKind: 'interrupted',
      message: 'The lookup was interrupted. Retry explicitly to resume.' } : state);
    return true;
  }
  /** Replace configuration identity before any refreshed request can publish.
   * Inactive tabs retain their input, but never display obsolete provider output. */
  reconfigure(configuration: Pick<Identity, 'configuration' | 'lookupLanguage' | 'explanationLanguage'>, visibleTabs: readonly number[]): void {
    const previous = [...this.#states.values()];
    for (const tabId of new Set([...this.#requests.keys(), ...this.#states.keys()])) this.begin(tabId);
    for (const state of previous) {
      const identity = { ...state.identity, configuration: configuration.configuration,
        lookupLanguage: configuration.lookupLanguage, explanationLanguage: configuration.explanationLanguage };
      const passage = state.passage;
      const refresh = !!state.text && (!passage || passage.selectedIndex !== undefined);
      this.#set({ identity, text: state.text, passage, generation: ++this.#generation, status: 'notice',
        ...(refresh ? { refreshOnView: true as const } : {}),
        message: passage && passage.selectedIndex === undefined
          ? 'Passage retained. Choose one word to look up; nothing has been sent.'
          : 'Settings changed. This selection will refresh when viewed.' });
      if (visibleTabs.includes(identity.tabId)) void this.view(identity.tabId);
    }
  }
  /** Consume only settings-deferred work. Eviction, interruption and an unchosen
   * passage never acquire an implicit request merely because a panel is viewed. */
  async view(tabId: number): Promise<void> {
    const state = this.#states.get(tabId);
    if (state?.status !== 'notice' || !state.refreshOnView) return;
    const request = this.begin(tabId, state.identity.frameId);
    const valid = await this.#sourceIsCurrent(state.identity).catch(() => false);
    if (!request.current()) return;
    if (!valid) { this.clear(tabId); return; }
    if (state.passage?.selectedIndex !== undefined) await request.selectWord(state.identity, state.passage.id, state.passage.selectedIndex);
    else await request.lookup(state.identity, state.text);
  }
  clear(tabId: number): void {
    this.#restorationClosed.add(tabId);
    this.#invalidate(tabId);
    this.#requests.delete(tabId);
    this.#wordChoices.delete(tabId);
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
    const deferred = this.#states.get(tabId);
    if (deferred?.status === 'notice' && deferred.refreshOnView) {
      // Persist the handoff as unfinished work. A worker stopped during source
      // validation must restore explicit Retry, not an inert ordinary notice.
      this.#set({ identity: deferred.identity, text: deferred.text, passage: deferred.passage,
        generation: deferred.generation, status: 'loading' });
    }
    this.#restorationClosed.add(tabId);
    this.#wordChoices.delete(tabId);
    this.#invalidate(tabId, !!this.#prepareLookup);
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
        if (!word || !previous || !sameIdentity(identity, previous.identity)) return;
        scope.frameId = identity.frameId;
        await this.#lookup(identity, word.text, request, deadline, { ...passage, selectedIndex: wordIndex });
      },
      notice: (identity, text, message) => {
        if (identity.tabId !== tabId) throw new Error('Lookup source belongs to another tab.');
        const publish = () => { if (current()) {
          this.#invalidate(tabId);
          this.#pending.get(tabId)?.abort();
          this.#pending.delete(tabId);
          this.#set({ identity: { ...identity }, text, generation: ++this.#generation, status: 'notice', message });
        } };
        if (this.#prepareLookup) void this.#prepareLookup(identity, current).then(accepted => { if (accepted) publish(); });
        else publish();
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
    const request = this.prepareWordChoice(tabId, passageId, wordIndex)?.();
    return state && request ? request.selectWord(state.identity, passageId, wordIndex) : Promise.resolve();
  }
  /** Reserve ordering without cancelling useful work while the browser validates
   * the active tab. Only a still-current, valid choice may start a new request. */
  prepareWordChoice(tabId: number, passageId: number, wordIndex: number): (() => LookupRequest | undefined) | undefined {
    const state = this.#states.get(tabId);
    if (!state?.passage || state.passage.id !== passageId || !Number.isInteger(wordIndex) || !state.passage.words[wordIndex]) return;
    const sourceToken = this.#requests.get(tabId)?.token;
    const choiceToken = Symbol();
    this.#wordChoices.set(tabId, choiceToken);
    return () => {
      if (this.#wordChoices.get(tabId) !== choiceToken || this.#requests.get(tabId)?.token !== sourceToken) return;
      return this.begin(tabId, state.identity.frameId);
    };
  }
  #set(state: State): void {
    this.#states.set(state.identity.tabId, state);
    this.#publish(state, state.identity.tabId);
  }
  async #lookup(identity: Identity, input: string, request: LookupRequest, deadline: number, passage?: Passage): Promise<void> {
    // A superseded result must be durably invalidated before accepting another
    // selection. If storage is unavailable, leave the previous selection current.
    if (this.#prepareLookup && (!await this.#prepareLookup(identity, request.current) || !request.current())) return;
    this.#invalidate(identity.tabId);
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
      const failureKind = error instanceof RequestFailure ? error.kind : undefined;
      if (current()) this.#set({ ...base, status: capabilityUnavailable(failureKind) ? 'unavailable' : 'error', failureKind, providerIssues: error instanceof RequestFailure ? error.issues : undefined, message: error instanceof Error ? error.message : 'Analysis failed. Try again.' });
    } finally {
      if (this.#pending.get(identity.tabId) === abort) this.#pending.delete(identity.tabId);
    }
  }
}
