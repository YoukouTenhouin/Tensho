import type { RequestFailureKind } from '../core/requests.ts';

const failures: Record<RequestFailureKind, string> = {
  'missing-access': 'Provider access needed.',
  'revoked-access': 'Provider access revoked.',
  network: 'Connection failed.',
  http: 'Provider unavailable.',
  format: 'Invalid provider response.',
  size: 'Response too large.',
  'request-timeout': 'Provider timed out.',
  'action-deadline': 'Lookup timed out.',
  cancelled: 'Lookup cancelled.',
  unconfigured: 'No providers enabled.',
  'unsupported-explanation': 'Explanations unavailable.',
  'unsupported-input': 'Input not supported.',
  'identity-mismatch': 'Unexpected dictionary entry.',
  interrupted: 'Lookup interrupted.',
};
export function failureText(work: { message: string; failureKind?: RequestFailureKind }): string {
  return work.failureKind ? failures[work.failureKind] : work.message;
}
export function dictionaryOutcome(status: 'confirmed-absence' | 'unresolved-mapping' | 'alternatives'): string {
  return status === 'confirmed-absence' ? 'No entry found.' : status === 'unresolved-mapping' ? 'Couldn’t identify an entry.' : 'Possible entries';
}
