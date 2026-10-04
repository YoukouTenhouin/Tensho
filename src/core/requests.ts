import { providerAccessRemoved } from './provider-access.ts';

export const requestFailureKinds = ['missing-access', 'revoked-access', 'network', 'http', 'format', 'size',
  'request-timeout', 'action-deadline', 'cancelled', 'unconfigured', 'unsupported-explanation', 'unsupported-input', 'identity-mismatch', 'interrupted'] as const;
export type RequestFailureKind = typeof requestFailureKinds[number];

export const capabilityUnavailable = (kind: RequestFailureKind | undefined) => kind === 'unconfigured' || kind === 'unsupported-explanation' || kind === 'unsupported-input';

export interface ProviderIssue {
  providerId: string; providerName: string; operation: 'analysis' | 'resolution' | 'article';
  kind: RequestFailureKind; message: string; attempted: boolean;
}
export type ProviderIssueObserver = (issues: readonly ProviderIssue[]) => void;
export class RequestFailure extends Error {
  readonly kind: RequestFailureKind;
  readonly issues: ProviderIssue[];
  constructor(kind: RequestFailureKind, message: string, issues: readonly ProviderIssue[] = []) {
    super(message); this.kind = kind; this.issues = [...issues]; this.name = 'RequestFailure';
  }
}

export const requestLimits = { concurrent: 2, requestMs: 15_000, actionMs: 30_000, analysisBytes: 1024 * 1024, articleBytes: 1024 * 1024, indexBytes: 8 * 1024 * 1024 } as const;
interface Pending { start(): void; }

/** Call inside the shared queue immediately before dispatch, and after awaited reads. */
export async function requireProviderAccess(permitted: (origins: readonly string[]) => Promise<boolean>,
  origins: readonly string[], signal: AbortSignal, deadline: number, message: string, kind: 'missing-access' | 'revoked-access' = 'missing-access'): Promise<void> {
  const allowed = await permitted(origins);
  signal.throwIfAborted();
  if (performance.now() >= deadline) throw new RequestFailure('action-deadline', 'Lookup exceeded its 30-second deadline.');
  if (!allowed) throw new RequestFailure(kind, message);
}

/** One shared instance owns all provider slots, including requests ignoring abort. */
export class RequestExecutor {
  #active = 0;
  #queue: Pending[] = [];
  #access = new Set<{ origins: readonly string[]; stop(): void }>();
  #limits: { concurrent: number; requestMs: number };
  constructor(limits: { concurrent: number; requestMs: number } = requestLimits) {
    this.#limits = limits;
    if (!Number.isInteger(limits.concurrent) || limits.concurrent < 1 || limits.requestMs <= 0) throw new Error('Invalid request limits');
  }
  revokeAccess(removed: readonly string[]): void {
    for (const request of [...this.#access]) if (providerAccessRemoved(request.origins, removed)) request.stop();
  }
  run<T>(execute: (signal: AbortSignal) => Promise<T>, options: { signal: AbortSignal; deadline: number; origins?: readonly string[] }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      let requestTimer: ReturnType<typeof setTimeout> | undefined;
      let actionTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: { value: T } | { error: unknown }) => {
        if (settled) return;
        settled = true;
        this.#access.delete(access);
        clearTimeout(requestTimer); clearTimeout(actionTimer);
        options.signal.removeEventListener('abort', cancel);
        const index = this.#queue.indexOf(pending);
        if (index >= 0) this.#queue.splice(index, 1);
        if ('error' in result) { controller.abort(); reject(result.error); }
        else resolve(result.value);
      };
      const cancel = () => finish({ error: new RequestFailure('cancelled', 'Lookup cancelled.') });
      const access = { origins: [...options.origins ?? []],
        stop: () => finish({ error: new RequestFailure('revoked-access', 'Provider access was revoked. Enable access explicitly before retrying.') }) };
      const pending: Pending = { start: () => {
        if (performance.now() >= options.deadline) { finish({ error: new RequestFailure('action-deadline', 'Lookup exceeded its 30-second deadline.') }); return; }
        this.#active++;
        const requestDeadline = performance.now() + this.#limits.requestMs;
        requestTimer = setTimeout(() => finish({ error: new RequestFailure('request-timeout', 'Provider request exceeded 15 seconds.') }), this.#limits.requestMs);
        // Never release a slot just because the caller stopped waiting. A provider
        // that ignores abort remains active until its operation actually settles.
        void Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          if (performance.now() >= options.deadline) throw new RequestFailure('action-deadline', 'Lookup exceeded its 30-second deadline.');
          return execute(controller.signal);
        }).then(value => {
          if (performance.now() >= options.deadline) finish({ error: new RequestFailure('action-deadline', 'Lookup exceeded its 30-second deadline.') });
          else if (performance.now() >= requestDeadline) finish({ error: new RequestFailure('request-timeout', 'Provider request exceeded 15 seconds.') });
          else finish({ value });
        }, error => finish({ error })).finally(() => {
          this.#active--; this.#pump();
        });
      } };
      if (options.signal.aborted) { cancel(); return; }
      const remaining = options.deadline - performance.now();
      if (remaining <= 0) { finish({ error: new RequestFailure('action-deadline', 'Lookup exceeded its 30-second deadline.') }); return; }
      options.signal.addEventListener('abort', cancel, { once: true });
      if (access.origins.length) this.#access.add(access);
      actionTimer = setTimeout(() => finish({ error: new RequestFailure('action-deadline', 'Lookup exceeded its 30-second deadline.') }), remaining);
      this.#queue.push(pending);
      this.#pump();
    });
  }
  #pump(): void {
    while (this.#active < this.#limits.concurrent && this.#queue.length) this.#queue.shift()!.start();
  }
}

/** Fetch bodies are decoded by the browser before streaming; bound before parsing. */
export async function readBoundedText(response: Response, signal: AbortSignal, maxBytes: number): Promise<string> {
  if (!response.ok) throw new RequestFailure('http', `Provider returned HTTP ${response.status}.`);
  if (!response.body) throw new RequestFailure('format', 'Provider returned no response body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) { cancel(); throw new RequestFailure('size', `Provider response exceeds the ${maxBytes / (1024 * 1024)} MiB decoded response limit.`); }
      chunks.push(next.value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(body); }
    catch { throw new RequestFailure('format', 'Provider returned invalid UTF-8.'); }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof RequestFailure) throw error;
    throw new RequestFailure('network', 'Provider response could not be read.');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function readBoundedJson(response: Response, signal: AbortSignal, maxBytes: number = requestLimits.analysisBytes): Promise<unknown> {
  const text = await readBoundedText(response, signal, maxBytes);
  try { return JSON.parse(text); }
  catch { throw new RequestFailure('format', 'Provider returned invalid JSON.'); }
}
