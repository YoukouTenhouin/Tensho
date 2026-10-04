import type { LookupCoordinator, Identity } from './lookup.ts';
import type { DictionaryCoordinator } from './dictionary.ts';
import { unretainedArticle } from './dictionary.ts';
import type { ReadingRecord } from './reading-record.ts';
import type { SessionResults } from './session-results.ts';

interface SessionCoordination {
  lookup: LookupCoordinator;
  dictionaries: DictionaryCoordinator;
  storage: SessionResults<ReadingRecord>;
  current(identity: Identity): Promise<boolean>;
  activeTabs(): Promise<number[]>;
  notify(): void;
}
const positionKey = (record: ReadingRecord) => `lookup:${record.state.generation}`;

/** Coordinates durable per-tab snapshots with live lookup state. Browser
 * visibility is deliberately absent: completion/restoration never opens UI. */
export class ReadingSession {
  #dependencies: SessionCoordination;
  #ready: Promise<void>;
  #tail: Promise<void> = Promise.resolve();
  #touched = new Set<number>();
  #epochs = new Map<number, number>();
  #activity = new Map<number, number>();
  #positions = new Map<number, { key: string; x: number; y: number }>();
  #cleared = new Set<number>();
  #failures = new Map<number, string>();
  #suppress = false;
  constructor(dependencies: SessionCoordination) {
    this.#dependencies = dependencies;
    this.#ready = this.#restore().catch(() => {
      // Lookups remain usable when session storage is unavailable, with an
      // explicit retention warning on the first attempted save.
    });
  }
  async #restore(): Promise<void> {
    const { storage, lookup, dictionaries, current } = this.#dependencies;
    for (const [tabId, saved] of await storage.entries()) {
      if (this.#touched.has(tabId)) continue;
      if (saved.status === 'cleared') { this.#cleared.add(tabId); continue; }
      if (saved.status !== 'retained') continue;
      const record = saved.value;
      const valid = record.state.identity.tabId === tabId && await current(record.state.identity).catch(() => false);
      if (this.#touched.has(tabId)) continue;
      if (!valid) { await storage.remove(tabId); continue; }
      this.#suppress = true;
      try {
        if (lookup.restore(record.state)) {
          dictionaries.restore(tabId, record.state.generation, record.dictionaries);
          this.#positions.set(tabId, { key: positionKey(record), ...record.scroll });
        }
      } finally { this.#suppress = false; }
    }
  }
  #queue(operation: () => Promise<void>): void {
    this.#tail = this.#tail.then(async () => { await this.#ready; await operation(); }).catch(() => {});
  }
  async settled(): Promise<void> { await this.#ready; await this.#tail; }
  async prepareLookup(tabId: number, current: () => boolean): Promise<boolean> {
    let accepted = false;
    this.#touched.add(tabId);
    this.#epochs.set(tabId, (this.#epochs.get(tabId) ?? 0) + 1);
    this.#queue(async () => {
      if (!current()) return;
      try { await this.#dependencies.storage.remove(tabId); accepted = true; }
      catch {
        this.#failures.set(tabId, 'A new lookup could not start because the previous result could not be cleared from session storage. Try again.');
        if (current()) {
          this.#dependencies.dictionaries.resume(tabId);
          this.#dependencies.lookup.retainAfterRefusal(tabId);
        }
        this.#dependencies.notify();
      }
    });
    await this.settled(); return accepted && current();
  }
  information(tabId: number) {
    const position = this.#positions.get(tabId);
    return { scroll: { x: position?.x ?? 0, y: position?.y ?? 0 },
      retentionNotice: this.#cleared.has(tabId) ? 'Previous result cleared to free space' : this.#failures.get(tabId) };
  }
  #capture(tabId: number): ReadingRecord | undefined {
    const state = this.#dependencies.lookup.get(tabId);
    if (!state) return;
    const record: ReadingRecord = { state, dictionaries: this.#dependencies.dictionaries.get(tabId), scroll: { x: 0, y: 0 } };
    const key = positionKey(record), previous = this.#positions.get(tabId);
    const position = previous?.key === key ? previous : { key, x: 0, y: 0 };
    this.#positions.set(tabId, position); record.scroll = { x: position.x, y: position.y };
    return structuredClone(record);
  }
  changed(tabId: number): void {
    if (this.#suppress) return;
    this.#touched.add(tabId); this.#cleared.delete(tabId);
    const record = this.#capture(tabId);
    if (!record) {
      this.#positions.delete(tabId); this.#failures.delete(tabId);
      this.#epochs.set(tabId, (this.#epochs.get(tabId) ?? 0) + 1);
    }
    const epoch = this.#epochs.get(tabId) ?? 0;
    this.#queue(async () => {
      if ((this.#epochs.get(tabId) ?? 0) !== epoch) return;
      try {
        if (record) await this.#save(tabId, record);
        else await this.#dependencies.storage.remove(tabId);
      } catch { this.#failure(tabId); }
    });
  }
  view(tabId: number): void {
    this.#queue(async () => { try { await this.#dependencies.storage.view(tabId); } catch { this.#failure(tabId); } });
  }
  activate(tabId: number): void {
    this.#activity.set(tabId, (this.#activity.get(tabId) ?? 0) + 1); this.view(tabId);
  }
  scroll(tabId: number, generation: number, x: number, y: number): void {
    if (this.#dependencies.lookup.get(tabId)?.generation !== generation || ![x, y].every(value => Number.isFinite(value) && value >= 0)) return;
    const record = this.#capture(tabId); if (!record) return;
    this.#positions.set(tabId, { key: positionKey(record), x, y }); this.changed(tabId);
  }
  #failure(tabId: number): void {
    if (this.#failures.has(tabId)) return;
    this.#failures.set(tabId, 'This result could not be retained in session storage. It may be unavailable after reopening.');
    this.#dependencies.notify();
  }
  async #save(tabId: number, record: ReadingRecord): Promise<void> {
    const { storage, lookup, dictionaries, activeTabs, notify } = this.#dependencies;
    const previous = await storage.get(tabId);
    // Non-query notices and settings changes can also replace a selection.
    if (previous?.status === 'retained' && previous.value.state.generation !== record.state.generation) await storage.remove(tabId);
    const evictionGuards = new Map((await storage.entries()).map(([id]) => {
      const current = lookup.guard(id), activity = this.#activity.get(id);
      return [id, { current, inactive: () => this.#activity.get(id) === activity }] as const;
    }));
    let result = await storage.save(tabId, record, await activeTabs());
    if (!result.retained) {
      // Replace only newly completed articles with an explicit resource outcome.
      // Existing articles and inactive tabs survive a failed atomic save.
      let released = false;
      for (const [index, candidate] of Object.entries(record.dictionaries)) {
        for (const [entryId, article] of Object.entries(candidate.articles)) {
          if (article.status !== 'complete') continue;
          const old = previous?.status === 'retained' && previous.value.state.generation === record.state.generation
            ? previous.value.dictionaries[Number(index)]?.articles[entryId] : undefined;
          if (old?.status === 'complete') continue;
          released = true;
          this.#suppress = true;
          try { dictionaries.releaseArticle(tabId, record.state.generation, Number(index), entryId, article.value); }
          finally { this.#suppress = false; }
          candidate.articles[entryId] = unretainedArticle(article.value.sourceUrl);
        }
      }
      if (released) result = await storage.save(tabId, record, (await storage.entries()).map(([id]) => id));
      if (!result.retained) { this.#failure(tabId); return; }
    }
    this.#failures.delete(tabId);
    const preserve: number[] = [];
    this.#suppress = true;
    try {
      for (const evicted of result.evicted) {
        // Storage writes are asynchronous. Activation or a newer reserved
        // lookup wins over the old victim snapshot; persist its live state next.
        const guard = evictionGuards.get(evicted);
        if (!guard?.current()) continue;
        if (!guard.inactive()) { preserve.push(evicted); continue; }
        this.#epochs.set(evicted, (this.#epochs.get(evicted) ?? 0) + 1);
        lookup.clear(evicted); this.#positions.delete(evicted); this.#cleared.add(evicted);
      }
    } finally { this.#suppress = false; }
    for (const tab of preserve) this.changed(tab);
    if (result.evicted.length) notify();
  }
}
