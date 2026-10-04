import type { EligibleProvider } from './configuration.ts';
import { RequestFailure } from './requests.ts';
import type { ProviderIssue, RequestFailureKind } from './requests.ts';

const technical = new Set<RequestFailureKind>(['network', 'http', 'format', 'size', 'identity-mismatch', 'request-timeout']);
export function technicalFailure(error: unknown): error is RequestFailure {
  return error instanceof RequestFailure && technical.has(error.kind);
}

/** One operation, one attempt per eligible provider. The adapter owns request
 * slots/timeouts; the whole chain shares the caller's existing action deadline. */
export async function runProviderChain<T>(options: {
  providers: readonly EligibleProvider[];
  operation: ProviderIssue['operation'];
  signal: AbortSignal;
  deadline: number;
  permitted(origins: readonly string[]): Promise<boolean>;
  current(signal: AbortSignal): Promise<unknown>;
  supports(provider: EligibleProvider): boolean;
  execute(provider: EligibleProvider, signal: AbortSignal): Promise<T>;
  priorIssues?: readonly ProviderIssue[];
}): Promise<{ value: T; provider: EligibleProvider; issues: ProviderIssue[] }> {
  const issues = [...(options.priorIssues ?? [])];
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (error: RequestFailure) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = (kind: 'cancelled' | 'action-deadline', message: string) => {
    if (controller.signal.aborted) return;
    const failure = new RequestFailure(kind, message, issues);
    controller.abort(failure); rejectAbort(failure);
  };
  const cancel = () => stop('cancelled', 'Lookup cancelled.');
  const check = () => {
    controller.signal.throwIfAborted();
    if (performance.now() >= options.deadline) throw new RequestFailure('action-deadline', 'Lookup exceeded its 30-second deadline; remaining providers were not attempted.', issues);
  };
  const record = (provider: EligibleProvider, failure: RequestFailure, attempted: boolean) => {
    issues.push({ providerId: provider.declaration.id, providerName: provider.declaration.name,
      operation: options.operation, kind: failure.kind, message: failure.message, attempted });
  };
  const run = async () => {
    for (const provider of options.providers) {
      check(); await options.current(controller.signal); check();
      if (!options.supports(provider)) {
        record(provider, new RequestFailure('unsupported-input', 'This provider does not support the selected input.'), false); continue;
      }
      const allowed = await options.permitted(provider.declaration.origins); check();
      if (!allowed) {
        record(provider, new RequestFailure('missing-access', 'Provider access is missing. Enable access explicitly to use this provider.'), false); continue;
      }
      try {
        const value = await options.execute(provider, controller.signal);
        check(); await options.current(controller.signal); check();
        return { value, provider, issues };
      } catch (error) {
        check();
        // Revocation after the eligibility check is still missing access, never
        // an instruction to request permission or retry the same provider.
        if (error instanceof RequestFailure && error.kind === 'missing-access') { record(provider, error, true); continue; }
        if (!technicalFailure(error)) {
          if (error instanceof RequestFailure) throw new RequestFailure(error.kind, error.message, issues);
          throw error;
        }
        record(provider, error, true);
      }
    }
    const failed = issues.filter(issue => technical.has(issue.kind));
    const kind = failed.at(-1)?.kind ?? (issues.some(issue => issue.kind === 'missing-access') ? 'missing-access' : 'unsupported-input');
    throw new RequestFailure(kind, failed.length
      ? 'Eligible providers failed technically. Retry explicitly under the current settings.'
      : kind === 'missing-access' ? 'Provider access is missing. Enable access explicitly before retrying.'
      : 'No eligible provider supports this input.', issues);
  };
  options.signal.addEventListener('abort', cancel, { once: true });
  if (options.signal.aborted) cancel();
  else timer = setTimeout(() => stop('action-deadline', 'Lookup exceeded its 30-second deadline; remaining providers were not attempted.'), Math.max(0, options.deadline - performance.now()));
  try { return await Promise.race([run(), stopped]); }
  finally { clearTimeout(timer); options.signal.removeEventListener('abort', cancel); }
}
