import { failureText } from './result-status.ts';
import type { ProviderIssue } from '../core/requests.ts';

/** Keep provider-specific failures visible without implying skipped services failed. */
export function providerFeedback(issues: readonly ProviderIssue[] | undefined, successfulProvider?: string): HTMLElement | undefined {
  if (!issues?.length) return;
  const section = document.createElement('section'); section.className = 'provider-feedback';
  const warning = document.createElement('p'); warning.setAttribute('role', 'status');
  warning.textContent = successfulProvider
    ? `Using ${successfulProvider}. ${issues.some(issue => issue.attempted && issue.kind !== 'missing-access') ? 'Previous provider failed.' : 'Provider unavailable.'}`
    : 'Provider details';
  const list = document.createElement('ul');
  for (const issue of issues) {
    const item = document.createElement('li');
    item.textContent = `${issue.providerName}: ${failureText({ failureKind: issue.kind, message: issue.message })}${issue.attempted ? '' : ' Skipped.'}`; list.append(item);
  }
  section.append(warning, list); return section;
}
