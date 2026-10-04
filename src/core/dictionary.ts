import type { ProviderIssue, ProviderIssueObserver } from './requests.ts';
import type { Analysis, Identity, State } from './lookup.ts';
import { RequestFailure, requestLimits, capabilityUnavailable } from './requests.ts';
import { technicalFailure } from './provider-chain.ts';
import type { DictionaryProvider } from '../providers/latin-dictionary.ts';
import type { DictionaryResolution } from '../providers/latin-index.ts';
import type { DictionaryArticle } from '../providers/latin-article.ts';

export type DictionaryWork<T> = { status: 'loading' } | { status: 'complete'; value: T } |
  { status: 'error' | 'unavailable'; message: string; failureKind?: RequestFailure['kind']; providerIssues?: ProviderIssue[] };
export type ArticleWork = DictionaryWork<DictionaryArticle> |
  { status: 'not-retained'; message: string; sourceUrl: string; providerIssues?: ProviderIssue[] };
export function unretainedArticle(sourceUrl: string): ArticleWork {
  return { status: 'not-retained', sourceUrl,
    message: 'This article could not be retained in session storage. Existing results have been preserved. Read the complete article at its source.' };
}
export interface CandidateDictionary {
  expanded: boolean;
  resolution: DictionaryWork<DictionaryResolution>;
  articles: Record<string, ArticleWork>;
}
interface RecoveringDictionary extends DictionaryProvider {
  recover?(candidate: Analysis['candidates'][number], previous: DictionaryResolution, failure: RequestFailure,
    identity: Identity, signal: AbortSignal, deadline: number, observe?: ProviderIssueObserver): Promise<DictionaryResolution | undefined>;
}
type ArticleOutcome = { article: DictionaryArticle } | { resolution: DictionaryResolution };
interface ReadingDictionary { generation: number; candidates: Record<number, CandidateDictionary>; }

/** Candidate-local work shares the analysis generation, never modifies analysis. */
export class DictionaryCoordinator {
  #states = new Map<number, ReadingDictionary>();
  #pending = new Map<number, Set<AbortController>>();
  #invalidGeneration = new Map<number, number>();
  #provider: RecoveringDictionary;
  #articleTails = new WeakMap<CandidateDictionary, Promise<void>>();
  #analysis: (tabId: number) => State | undefined;
  #publish: (tabId: number) => void;
  #sourceIsCurrent: (identity: Identity) => Promise<boolean>;
  constructor(provider: RecoveringDictionary, analysis: (tabId: number) => State | undefined,
    publish: (tabId: number) => void, sourceIsCurrent: (identity: Identity) => Promise<boolean>) {
    this.#provider = provider; this.#analysis = analysis; this.#publish = publish; this.#sourceIsCurrent = sourceIsCurrent;
  }
  get(tabId: number): Record<number, CandidateDictionary> {
    const saved = this.#states.get(tabId);
    return saved?.generation === this.#analysis(tabId)?.generation ? saved?.candidates ?? {} : {};
  }
  releaseArticle(tabId: number, generation: number, candidateIndex: number, entryId: string, article: DictionaryArticle): void {
    if (this.#analysis(tabId)?.generation !== generation) return;
    const candidate = this.get(tabId)[candidateIndex];
    const current = candidate?.articles[entryId];
    if (!candidate || current?.status !== 'complete' || current.value.sourceUrl !== article.sourceUrl) return;
    candidate.articles[entryId] = unretainedArticle(article.sourceUrl);
    this.#publish(tabId);
  }
  /** Restore completed work without fetching; interrupted pieces require retry. */
  restore(tabId: number, generation: number, saved: Record<number, CandidateDictionary>): boolean {
    const analysis = this.#analysis(tabId);
    if (analysis?.status !== 'complete' || analysis.generation !== generation || this.#states.has(tabId) ||
      this.#invalidGeneration.get(tabId) === generation) return false;
    const candidates = structuredClone(saved);
    const interrupted = <T>(work: DictionaryWork<T>): DictionaryWork<T> => work.status === 'loading'
      ? { status: 'error', failureKind: 'interrupted', message: 'This dictionary action was interrupted. Retry explicitly to resume.' } : work;
    for (const candidate of Object.values(candidates)) {
      candidate.resolution = interrupted(candidate.resolution);
      for (const [id, article] of Object.entries(candidate.articles)) candidate.articles[id] = article.status === 'not-retained' ? article : interrupted(article);
    }
    this.#states.set(tabId, { generation, candidates }); this.#publish(tabId); return true;
  }
  invalidate(tabId: number): void {
    this.suspend(tabId); this.#states.delete(tabId);
  }
  /** Stop old work while a replacement is acquiring durable storage, retaining
   * completed content until the new selection is actually accepted. */
  suspend(tabId: number): void {
    const state = this.#analysis(tabId);
    if (state) this.#invalidGeneration.set(tabId, state.generation);
    for (const controller of this.#pending.get(tabId) ?? []) controller.abort();
    this.#pending.delete(tabId);
  }
  resume(tabId: number): void {
    if (this.#invalidGeneration.get(tabId) !== this.#analysis(tabId)?.generation) return;
    this.#invalidGeneration.delete(tabId);
    const interrupted = { status: 'error', failureKind: 'interrupted', message: 'This dictionary action was interrupted. Retry explicitly to resume.' } as const;
    for (const candidate of Object.values(this.get(tabId))) {
      if (candidate.resolution.status === 'loading') candidate.resolution = interrupted;
      for (const [id, article] of Object.entries(candidate.articles)) if (article.status === 'loading') candidate.articles[id] = interrupted;
    }
    this.#publish(tabId);
  }
  collapse(tabId: number, generation: number, candidateIndex: number): void {
    if (this.#analysis(tabId)?.generation !== generation) return;
    const candidate = this.get(tabId)[candidateIndex];
    if (candidate) { candidate.expanded = false; this.#publish(tabId); }
  }
  async resolve(tabId: number, generation: number, candidateIndex: number, retry = false): Promise<void> {
    const scope = this.#scope(tabId, generation, candidateIndex);
    if (!scope) return;
    let reading = this.#states.get(tabId);
    if (!reading || reading.generation !== generation) {
      reading = { generation, candidates: {} }; this.#states.set(tabId, reading);
    }
    const existing = reading.candidates[candidateIndex];
    if (existing) {
      existing.expanded = true;
      if (existing.resolution.status !== 'error' || !retry) { this.#publish(tabId); return; }
    }
    const candidate = existing ?? { expanded: true, resolution: { status: 'loading' }, articles: {} };
    reading.candidates[candidateIndex] = candidate;
    candidate.resolution = { status: 'loading' }; this.#publish(tabId);
    await this.#run(scope, (signal, deadline, observe) => this.#provider.resolve(scope.candidate, scope.state.identity, signal, deadline, undefined, observe),
      value => { candidate.resolution = value; });
  }
  async retrieve(tabId: number, generation: number, candidateIndex: number, entryId: string, retry = false, providerId?: string): Promise<void> {
    const scope = this.#scope(tabId, generation, candidateIndex);
    if (!scope) return;
    const candidate = this.get(tabId)[candidateIndex];
    if (candidate?.resolution.status !== 'complete') return;
    const resolution = candidate.resolution.value;
    if (providerId !== undefined && providerId !== resolution.providerId) return;
    if (!resolution.alternatives.some(item => item.entryId === entryId)) return;
    const existing = candidate.articles[entryId];
    if (existing && (existing.status !== 'error' || !retry)) return;
    candidate.articles[entryId] = { status: 'loading' }; this.#publish(tabId);
    const deadline = performance.now() + requestLimits.actionMs;
    // Serialize choices for this candidate only. A first usable article commits
    // its provider before a later choice can fail; other candidates remain independent.
    const previous = this.#articleTails.get(candidate) ?? Promise.resolve();
    const action = previous.then(async () => {
      if (this.#scope(tabId, generation, candidateIndex)?.state !== scope.state ||
        candidate.resolution.status !== 'complete' || candidate.resolution.value !== resolution) return;
      let recovering = false;
      await this.#run<ArticleOutcome>(scope, async (signal, actionDeadline, observe) => {
        try { return { article: await this.#provider.retrieve(resolution, entryId, scope.state.identity, signal, actionDeadline, undefined, observe) }; }
        catch (error) {
          signal.throwIfAborted();
          if (!technicalFailure(error) || !this.#provider.recover || Object.values(candidate.articles).some(article => article.status === 'complete' || article.status === 'not-retained')) throw error;
          recovering = true; candidate.resolution = { status: 'loading' }; this.#publish(tabId);
          const next = await this.#provider.recover(scope.candidate, resolution, error, scope.state.identity, signal, actionDeadline, observe);
          if (next) return { resolution: next };
          recovering = false; candidate.resolution = { status: 'complete', value: resolution }; throw error;
        }
      }, value => {
        if (value.status === 'complete') {
          if ('article' in value.value) candidate.articles[entryId] = { status: 'complete', value: value.value.article };
          else { candidate.resolution = { status: 'complete', value: value.value.resolution }; candidate.articles = {}; }
        } else if (recovering) { candidate.resolution = value; candidate.articles = {}; }
        else candidate.articles[entryId] = value;
      }, deadline);
    });
    this.#articleTails.set(candidate, action.catch(() => {}));
    await action;
  }
  #scope(tabId: number, generation: number, candidateIndex: number) {
    const state = this.#analysis(tabId);
    if (state?.status !== 'complete' || state.generation !== generation ||
      this.#invalidGeneration.get(tabId) === generation || !Number.isInteger(candidateIndex)) return;
    const candidate = state.analysis.candidates[candidateIndex];
    if (!candidate) return;
    return { state, candidate };
  }
  async #run<T>(scope: { state: State; candidate: Analysis['candidates'][number] },
    execute: (signal: AbortSignal, deadline: number, observe: ProviderIssueObserver) => Promise<T>, save: (value: DictionaryWork<T>) => void,
    deadline = performance.now() + requestLimits.actionMs): Promise<void> {
    const tabId = scope.state.identity.tabId;
    const controller = new AbortController();
    const pending = this.#pending.get(tabId) ?? new Set<AbortController>();
    pending.add(controller); this.#pending.set(tabId, pending);
    let providerIssues: ProviderIssue[] = [];
    const observe: ProviderIssueObserver = issues => { if (!controller.signal.aborted) providerIssues = [...issues]; };
    const current = () => !controller.signal.aborted && this.#analysis(tabId) === scope.state &&
      this.#invalidGeneration.get(tabId) !== scope.state.generation;
    const timer = setTimeout(() => {
      if (!current()) return;
      controller.abort();
      save({ status: 'error', failureKind: 'action-deadline', message: 'Dictionary action exceeded its 30-second deadline; remaining providers were not attempted.', providerIssues });
      this.#publish(tabId);
    }, Math.max(0, deadline - performance.now()));
    let interrupted!: () => void;
    const stopped = new Promise<void>(resolve => { interrupted = resolve; });
    controller.signal.addEventListener('abort', interrupted, { once: true });
    const perform = async () => {
      const validSource = await this.#sourceIsCurrent(scope.state.identity);
      if (!current()) return;
      if (!validSource) { this.invalidate(tabId); this.#publish(tabId); return; }
      if (performance.now() >= deadline) throw new RequestFailure('action-deadline', 'Dictionary action exceeded its 30-second deadline before dispatch.', providerIssues);
      const value = await execute(controller.signal, deadline, observe);
      if (!current()) return;
      const sourceCurrent = await this.#sourceIsCurrent(scope.state.identity);
      if (!current()) return;
      if (!sourceCurrent) { this.invalidate(tabId); this.#publish(tabId); return; }
      save({ status: 'complete', value }); this.#publish(tabId);
    };
    try { await Promise.race([perform(), stopped]); } catch (error) {
      if (current()) {
        const failureKind = error instanceof RequestFailure ? error.kind : undefined;
        save({ status: capabilityUnavailable(failureKind) ? 'unavailable' : 'error', message: error instanceof Error ? error.message : 'Dictionary action failed. Retry explicitly.', failureKind, providerIssues: error instanceof RequestFailure ? error.issues : undefined });
        this.#publish(tabId);
      }
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', interrupted);
      pending.delete(controller);
      if (!pending.size && this.#pending.get(tabId) === pending) this.#pending.delete(tabId);
    }
  }
}
