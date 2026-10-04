export const readingSessionKey = 'readingResults';
export const readingSessionBytes = 6 * 1024 * 1024;
export class SessionQuotaError extends Error {}
export interface SessionStorage { read(): Promise<unknown>; write(value: unknown): Promise<void>; }
export type RetainedTab<T> = { viewed: number } & (
  { status: 'retained'; value: T } | { status: 'cleared' | 'empty' }
);
interface SessionData<T> { schema: 1; clock: number; tabs: Record<string, RetainedTab<T>>; }
export type RetentionResult = { retained: true; evicted: number[] } | { retained: false; reason: 'size' | 'quota' | 'storage' };

/** Count the actual UTF-8 JSON representation, including the storage envelope. */
export function serializedSessionBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify({ [readingSessionKey]: value })).byteLength;
}

/** A single atomic session value contains one current result per tab. The
 * browser adapter supplies domain validation; this layer owns resource policy. */
export class SessionResults<T> {
  #storage: SessionStorage;
  #valid: (value: unknown) => value is T;
  #limit: number;
  #data: SessionData<T> = { schema: 1, clock: 0, tabs: {} };
  #ready: Promise<void>;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(storage: SessionStorage, valid: (value: unknown) => value is T, limit = readingSessionBytes) {
    this.#storage = storage; this.#valid = valid; this.#limit = limit;
    this.#ready = (async () => {
      const saved = await storage.read();
      if (this.#isSession(saved) && serializedSessionBytes(saved) <= limit) this.#data = structuredClone(saved);
    })();
  }
  #isSession(value: unknown): value is SessionData<T> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const session = value as Partial<SessionData<unknown>>;
    if (session.schema !== 1 || !Number.isSafeInteger(session.clock) || session.clock! < 0 ||
      !session.tabs || typeof session.tabs !== 'object' || Array.isArray(session.tabs)) return false;
    return Object.entries(session.tabs).every(([tabId, entry]) => /^(0|[1-9][0-9]*)$/.test(tabId) && Number.isSafeInteger(Number(tabId)) &&
      entry && typeof entry === 'object' && Number.isSafeInteger(entry.viewed) && entry.viewed >= 0 && entry.viewed <= session.clock! &&
      (entry.status === 'retained' ? this.#valid(entry.value) : entry.status === 'cleared' || entry.status === 'empty'));
  }
  #transaction<R>(operation: () => Promise<R>): Promise<R> {
    const next = this.#tail.then(async () => { await this.#ready; return operation(); });
    this.#tail = next.catch(() => {}); return next;
  }
  async get(tabId: number): Promise<RetainedTab<T> | undefined> {
    await this.#ready; await this.#tail; return structuredClone(this.#data.tabs[tabId]);
  }
  async entries(): Promise<[number, RetainedTab<T>][]> {
    await this.#ready; await this.#tail;
    return Object.entries(structuredClone(this.#data.tabs)).map(([id, value]) => [Number(id), value]);
  }
  save(tabId: number, value: T, activeTabs: readonly number[]): Promise<RetentionResult> {
    if (!Number.isSafeInteger(tabId) || tabId < 0 || !this.#valid(value)) return Promise.reject(new Error('Invalid retained reading result.'));
    const captured = structuredClone(value);
    const protectedTabs = new Set([...activeTabs, tabId]);
    return this.#transaction(async () => {
      const next = structuredClone(this.#data);
      next.tabs[tabId] = { status: 'retained', viewed: next.tabs[tabId]?.viewed ?? 0, value: captured };
      const victims = Object.entries(next.tabs).filter(([id, entry]) => entry.status === 'retained' && !protectedTabs.has(Number(id)))
        .sort(([leftId, left], [rightId, right]) => left.viewed - right.viewed || Number(leftId) - Number(rightId));
      const evicted: number[] = [];
      const evict = () => {
        const victim = victims.shift(); if (!victim) return false;
        const [id, entry] = victim; next.tabs[id] = { status: 'cleared', viewed: entry.viewed }; evicted.push(Number(id)); return true;
      };
      while (true) {
        if (serializedSessionBytes(next) > this.#limit) {
          if (evict()) continue;
          return { retained: false, reason: 'size' };
        }
        try { await this.#storage.write(next); }
        catch (error) {
          if (error instanceof SessionQuotaError && evict()) continue;
          return { retained: false, reason: error instanceof SessionQuotaError ? 'quota' : 'storage' };
        }
        this.#data = next; return { retained: true, evicted };
      }
    });
  }
  view(tabId: number): Promise<void> {
    if (!Number.isSafeInteger(tabId) || tabId < 0) return Promise.reject(new Error('Invalid reading tab.'));
    return this.#transaction(async () => {
      const next = structuredClone(this.#data);
      next.tabs[tabId] = { ...(next.tabs[tabId] ?? { status: 'empty' }), viewed: ++next.clock };
      if (serializedSessionBytes(next) > this.#limit) return;
      await this.#storage.write(next); this.#data = next;
    });
  }
  remove(tabId: number): Promise<void> {
    if (!Number.isSafeInteger(tabId) || tabId < 0) return Promise.reject(new Error('Invalid reading tab.'));
    return this.#transaction(async () => {
      if (!this.#data.tabs[tabId]) return;
      const next = structuredClone(this.#data); delete next.tabs[tabId];
      await this.#storage.write(next); this.#data = next;
    });
  }
}
