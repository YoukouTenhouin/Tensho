import { t } from './i18n.ts';
import { providerFeedback } from './provider-feedback.ts';
import type { CandidateDictionary } from '../core/dictionary.ts';
import type { DictionaryArticle } from '../providers/latin-article.ts';
import { dictionaryLabels } from './dictionary-labels.ts';
import { dictionaryOutcome, failureText } from './result-status.ts';
import { safeHttpsUrl } from '../core/safe-links.ts';

type Action = (type: string, extra?: Record<string, unknown>) => void;
function paragraph(text: string): HTMLParagraphElement {
  const element = document.createElement('p'); element.textContent = text; return element;
}
function button(text: string, id: string, action: () => void): HTMLButtonElement {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
  element.id = id; element.onclick = action; return element;
}
function link(value: string, label: string): HTMLAnchorElement | undefined {
  const url = safeHttpsUrl(value);
  if (!url) return;
  const element = document.createElement('a'); element.href = url; element.textContent = label;
  element.target = '_blank'; element.rel = 'noopener noreferrer'; return element;
}

/** Render data exclusively through extension-owned elements and textContent. */
export function renderArticle(article: DictionaryArticle, explanationLanguage?: string): HTMLElement {
  const section = document.createElement('section'); section.className = 'dictionary-article';
  const heading = document.createElement('h5'); heading.textContent = article.dictionary;
  section.append(heading);
  const feedback = providerFeedback(article.providerIssues, article.dictionary); if (feedback) section.append(feedback);
  for (const text of article.paragraphs) { const value = paragraph(text); if (explanationLanguage) value.lang = explanationLanguage; section.append(value); }
  // Source credits are also preserved in their original position in paragraphs.
  if (article.attribution.length) section.setAttribute('aria-label', t('articleAttribution', { dictionary: article.dictionary }));
  const source = link(article.sourceUrl, t('dictionarySource'));
  if (source) section.append(source);
  if (article.links.length) {
    const list = document.createElement('ul'); list.setAttribute('aria-label', t('dictionaryReferences'));
    for (const [index, url] of article.links.entries()) {
      const reference = link(url, t('reference', { index: index + 1 }));
      if (reference) { const item = document.createElement('li'); item.append(reference); list.append(item); }
    }
    section.append(list);
  }
  return section;
}

export function renderDictionary(candidate: CandidateDictionary | undefined, index: number, action: Action, explanationLanguage?: string): HTMLElement {
  const section = document.createElement('section'); section.className = 'dictionary';
  const expanded = candidate?.expanded ?? false;
  const toggle = button(expanded ? t('hideDictionary') : t('dictionary'), `dictionary-${index}`,
    () => action(expanded ? 'dictionary-collapse' : 'dictionary-resolve'));
  toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-controls', `dictionary-content-${index}`);
  section.append(toggle);
  const content = document.createElement('div'); content.id = `dictionary-content-${index}`; content.hidden = !expanded;
  section.append(content);
  if (!candidate || !expanded) return section;
  const work = candidate.resolution;
  const status = paragraph(''); status.setAttribute('role', 'status'); content.append(status);
  content.setAttribute('aria-busy', String(work.status === 'loading'));
  if (work.status === 'loading') status.textContent = t('loadingEntries');
  else if (work.status === 'error' || work.status === 'unavailable') {
    status.textContent = failureText(work);
    const feedback = providerFeedback(work.providerIssues); if (feedback) content.append(feedback);
    if (work.status === 'error') content.append(button(t('retryDictionary'), `dictionary-retry-${index}`, () => action('dictionary-resolve', { retry: true })));
  } else if (work.status === 'complete') {
    const resolution = work.value;
    const feedback = providerFeedback(resolution.providerIssues, resolution.providerName); if (feedback) content.append(feedback);
    status.textContent = dictionaryOutcome(resolution.status);
    const labels = dictionaryLabels(resolution);
    for (const alternative of resolution.alternatives) {
      const item = document.createElement('section'); item.className = 'dictionary-alternative';
      const label = labels.get(alternative.entryId)!.heading;
      const heading = document.createElement('h4'); heading.textContent = label;
      item.append(heading);
      const article = candidate.articles[alternative.entryId];
      const id = `article-${index}-${alternative.entryId}`;
      item.id = `${id}-region`; item.tabIndex = -1; item.setAttribute('aria-label', label);
      if (!article) item.append(button(t('readEntry'), id, () => action('dictionary-retrieve', { entryId: alternative.entryId, providerId: resolution.providerId })));
      else if (article.status === 'complete') item.append(renderArticle(article.value, explanationLanguage));
      else {
        const message = paragraph(article.status === 'loading' ? t('loadingEntry') : article.status === 'not-retained' ? t('entryTooLarge') : failureText(article));
        message.setAttribute('role', 'status'); item.append(message);
        if (article.status !== 'loading') { const feedback = providerFeedback(article.providerIssues); if (feedback) item.append(feedback); }
        if (article.status === 'not-retained') { const source = link(article.sourceUrl, t('readSource')); if (source) item.append(source); }
        if (article.status === 'error') item.append(button(t('retryEntry'), id,
          () => action('dictionary-retrieve', { entryId: alternative.entryId, providerId: resolution.providerId, retry: true })));
      }
      content.append(item);
    }
  }
  return section;
}
