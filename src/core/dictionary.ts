import type { ProviderIssue } from './requests.ts';
import type { Analysis, Identity, State } from './lookup.ts';
import { RequestFailure, requestLimits, capabilityUnavailable } from './requests.ts';
import type { DictionaryProvider } from '../providers/latin-dictionary.ts';
import type { DictionaryResolution } from '../providers/latin-index.ts';
import type { DictionaryArticle } from '../providers/latin-article.ts';

export type DictionaryWork<T> = { status: 'loading' } | { status: 'complete'; value: T } |
  { status: 'error' | 'unavailable'; message: string; failureKind?: RequestFailure['kind']; providerIssues?: ProviderIssue[] };
export interface CandidateDictionary {
  expanded: boolean;
  resolution: DictionaryWork<DictionaryResolution>;
  articles: Record<string, DictionaryWork<DictionaryArticle>>;
}
interface ReadingDictionary { generation: number; candidates: Record<number, CandidateDictionary>; }

/** Candidate-local work shares the analysis generation, never modifies analysis. */
export class DictionaryCoordinator {
  #states = new Map<number, ReadingDictionary>();
  #pending = new Map<number, Set<AbortController>>();
  #invalidGeneration = new Map<number, number>();
  #provider: DictionaryProvider;
  #analysis: (tabId: number) => State | undefined;
  #publish: () => void;
  #sourceIsCurrent: (identity: Identity) => Promise<boolean>;
  constructor(provider: DictionaryProvider, analysis: (tabId: number) => State | undefined,
    publish: () => void, sourceIsCurrent: (identity: Identity) => Promise<boolean>) {
    this.#provider = provider; this.#analysis = analysis; this.#publish = publish; this.#sourceIsCurrent = sourceIsCurrent;
  }
  get(tabId: number): Record<number, CandidateDictionary> {
    const saved = this.#states.get(tabId);
    return saved?.generation === this.#analysis(tabId)?.generation ? saved?.candidates ?? {} : {};
  }
  invalidate(tabId: number): void {
    const state = this.#analysis(tabId);
    if (state) this.#invalidGeneration.set(tabId, state.generation);
    for (const controller of this.#pending.get(tabId) ?? []) controller.abort();
    this.#pending.delete(tabId); this.#states.delete(tabId);
  }
  collapse(tabId: number, generation: number, candidateIndex: number): void {
    if (this.#analysis(tabId)?.generation !== generation) return;
    const candidate = this.get(tabId)[candidateIndex];
    if (candidate) { candidate.expanded = false; this.#publish(); }
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
      if (existing.resolution.status !== 'error' || !retry) { this.#publish(); return; }
    }
    const candidate = existing ?? { expanded: true, resolution: { status: 'loading' }, articles: {} };
    reading.candidates[candidateIndex] = candidate;
    candidate.resolution = { status: 'loading' }; this.#publish();
    await this.#run(scope, (signal, deadline) => this.#provider.resolve(scope.candidate, scope.state.identity, signal, deadline),
      value => { candidate.resolution = value; });
  }
  async retrieve(tabId: number, generation: number, candidateIndex: number, entryId: string, retry = false): Promise<void> {
    const scope = this.#scope(tabId, generation, candidateIndex);
    if (!scope) return;
    const candidate = this.get(tabId)[candidateIndex];
    if (candidate?.resolution.status !== 'complete') return;
    const resolution = candidate.resolution.value;
    if (!resolution.alternatives.some(item => item.entryId === entryId)) return;
    const existing = candidate.articles[entryId];
    if (existing && (existing.status !== 'error' || !retry)) return;
    candidate.articles[entryId] = { status: 'loading' }; this.#publish();
    await this.#run(scope, (signal, deadline) => this.#provider.retrieve(resolution, entryId, scope.state.identity, signal, deadline),
      value => { candidate.articles[entryId] = value; });
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
    execute: (signal: AbortSignal, deadline: number) => Promise<T>, save: (value: DictionaryWork<T>) => void): Promise<void> {
    const tabId = scope.state.identity.tabId;
    const controller = new AbortController();
    const pending = this.#pending.get(tabId) ?? new Set<AbortController>();
    pending.add(controller); this.#pending.set(tabId, pending);
    const deadline = performance.now() + requestLimits.actionMs;
    const current = () => !controller.signal.aborted && this.#analysis(tabId) === scope.state &&
      this.#invalidGeneration.get(tabId) !== scope.state.generation;
    const timer = setTimeout(() => {
      if (!current()) return;
      controller.abort();
      save({ status: 'error', failureKind: 'action-deadline', message: 'Dictionary action exceeded its 30-second deadline.' });
      this.#publish();
    }, requestLimits.actionMs);
    try {
      const validSource = await this.#sourceIsCurrent(scope.state.identity);
      if (!current()) return;
      if (!validSource) { this.invalidate(tabId); this.#publish(); return; }
      const value = await execute(controller.signal, deadline);
      if (!current()) return;
      const sourceCurrent = await this.#sourceIsCurrent(scope.state.identity);
      if (!current()) return;
      if (!sourceCurrent) { this.invalidate(tabId); this.#publish(); return; }
      save({ status: 'complete', value }); this.#publish();
    } catch (error) {
      if (current()) {
        const failureKind = error instanceof RequestFailure ? error.kind : undefined;
        save({ status: capabilityUnavailable(failureKind) ? 'unavailable' : 'error', message: error instanceof Error ? error.message : 'Dictionary action failed. Retry explicitly.', failureKind, providerIssues: error instanceof RequestFailure ? error.issues : undefined });
        this.#publish();
      }
    } finally {
      clearTimeout(timer);
      pending.delete(controller);
      if (!pending.size && this.#pending.get(tabId) === pending) this.#pending.delete(tabId);
    }
  }
}
