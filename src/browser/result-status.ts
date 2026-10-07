import type { RequestFailureKind } from '../core/requests.ts';
import type { MessageId, UiMessage } from '../i18n/messages.ts';
import { currentLocale, t, uiText } from './i18n.ts';

const failures: Record<RequestFailureKind, MessageId> = {
  'missing-access': 'failure_missing_access', 'revoked-access': 'failure_revoked_access',
  network: 'failure_network', http: 'failure_http', format: 'failure_format', size: 'failure_size',
  'request-timeout': 'failure_request_timeout', 'action-deadline': 'failure_action_deadline',
  cancelled: 'failure_cancelled', unconfigured: 'failure_unconfigured', 'unsupported-explanation': 'failure_unsupported_explanation',
  'unsupported-input': 'failure_unsupported_input', 'identity-mismatch': 'failure_identity_mismatch', interrupted: 'failure_interrupted',
};
export function failureText(work: { message: string; failureKind?: RequestFailureKind; uiMessage?: UiMessage }): string {
  if (work.failureKind) return t(failures[work.failureKind]);
  if (work.uiMessage) return uiText(work.uiMessage);
  // Legacy/provider fallback text can be preserved in English, but is never presented as a Chinese translation.
  return currentLocale() === 'en' ? work.message : t('legacyNotice');
}
export function dictionaryOutcome(status: 'confirmed-absence' | 'unresolved-mapping' | 'alternatives'): string {
  return t(status === 'confirmed-absence' ? 'noEntry' : status === 'unresolved-mapping' ? 'unresolvedEntry' : 'possibleEntries');
}
