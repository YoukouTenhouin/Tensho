import { currentLocale, message, setLocale, t, uiText, UiError } from './i18n.ts';
import { errorMessage, isUiMessage } from '../i18n/messages.ts';
import type { UiMessage } from '../i18n/messages.ts';
import { describeGrammar } from './grammar-view.ts';
import type { State } from '../core/lookup.ts';
import { permissionPattern, readingOrigin } from '../core/origins.ts';
import { providerFeedback } from './provider-feedback.ts';
import { renderDictionary } from './dictionary-view.ts';
import { DictionaryAnnouncements } from './dictionary-announcements.ts';
import { LiveStatus } from './live-status.ts';
import { languageName, explanationName } from './settings-view.ts';
import { failureText } from './result-status.ts';
import { LanguageView } from './language-view.ts';
function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const results = element('results'), status = element('status'), target = element('target'), analysis = element('analysis');
const word = element<HTMLTextAreaElement>('word'), feedback = element('feedback');
const dictionaryAnnouncements = new DictionaryAnnouncements(element('dictionary-status'));
const analysisStatus = new LiveStatus(status);
let windowId: number;
let origin: string | undefined;
let revision = 0, displayed = '', viewport = '', renderedPassage = '', focused = '', tabId = -1;
let displayedGeneration: number | undefined, restoringScroll = false;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
let pendingScroll: Record<string, unknown> | undefined;
async function send(message: Record<string, unknown>): Promise<any> {
  const reply = await chrome.runtime.sendMessage({ windowId, tabId, ...message });
  if (reply?.error) throw new UiError(isUiMessage(reply.uiMessage) ? reply.uiMessage : { id: 'unexpectedError' });
  return reply;
}
const languageView = new LanguageView(async (lookupLanguage, explanationLanguage, expectedRevision) => {
  try { await send({ type: 'save-preferences', lookupLanguage, explanationLanguage, expectedRevision }); }
  finally { await refresh(); }
});
let feedbackMessage: UiMessage | undefined;
function showFeedback(value: UiMessage): void { feedbackMessage = value; feedback.textContent = uiText(value); }
function report(error: unknown): void { showFeedback(errorMessage(error)); setLocale(currentLocale()); }
async function refresh(): Promise<void> {
  flushScroll();
  const current = ++revision;
  const snapshot = await send({ type: 'snapshot' });
  if (current !== revision) return;
  const localeChanged = setLocale(snapshot.interfaceLocale);
  if (localeChanged) analysisStatus.reset();
  if (feedbackMessage) feedback.textContent = uiText(feedbackMessage);
  tabId = snapshot.tabId; origin = snapshot.origin;
  const language = languageName(snapshot.settings.lookupLanguage, snapshot.catalog);
  const explanation = snapshot.settings.languages[snapshot.settings.lookupLanguage].explanationLanguage;
  const explanationLabel = explanationName(explanation);
  languageView.update(snapshot.settings, snapshot.catalog);
  element('configuration-status').textContent = !snapshot.routes.analysis.length
    ? t('analysisUnavailable', { language })
    : !snapshot.routes.dictionary.length ? t('dictionaryUnavailable', { language: explanationLabel })
    : snapshot.routes.analysisMode === 'structural-only' ? t('meaningsUnavailable', { language: explanationLabel }) : '';
  const state: State | undefined = snapshot.state;
  const key = `${tabId}:${state?.generation ?? 'none'}`;
  const focusId = key === displayed && document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  const viewportKey = key;
  const scroll = viewportKey !== viewport ? snapshot.scroll ?? { x: 0, y: 0 } : { x: window.scrollX, y: window.scrollY };
  viewport = viewportKey; displayedGeneration = state?.generation; restoringScroll = true;
  displayed = key;
  const passage = state?.passage;
  const passageKey = passage ? `${tabId}:${passage.id}:${currentLocale()}` : '';
  element('passage').hidden = !passage;
  if (passageKey !== renderedPassage) {
    renderedPassage = passageKey;
    element('passage-original').textContent = passage?.original ?? '';
    const controls = element('passage-words'); controls.replaceChildren();
    passage?.words.forEach((offered, wordIndex) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = offered.text;
      button.id = `passage-word-${wordIndex}`;
      button.setAttribute('aria-label', t('passageWord', { word: offered.text, index: wordIndex + 1, total: passage.words.length }));
      button.onclick = () => { void send({ type: 'passage-word', passageId: passage.id, wordIndex }).then(refresh).catch(report); };
      controls.append(button);
    });
  }
  for (const [index, button] of Array.from(element('passage-words').querySelectorAll('button')).entries()) {
    button.setAttribute('aria-pressed', String(index === passage?.selectedIndex));
  }
  target.textContent = passage && passage.selectedIndex === undefined ? t('chooseWord') : state?.text || t('ready');
  analysis.replaceChildren();
  const statusMessage = (() => {
    if (!state) return isUiMessage(snapshot.retentionMessage) ? uiText(snapshot.retentionMessage) : snapshot.retentionNotice ? t('retentionFailed') : '';
    if (state.status === 'loading') return t('loadingAnalysis', { language });
    if (state.status !== 'complete') return state.status === 'notice' && state.passage && state.passage.selectedIndex === undefined
      ? t('chooseWord') : failureText(state);
    const result = state.analysis;
    return result.controlled && !result.outcome ? result.provider : result.outcome === 'no-match' ? t('noMatch', { language, provider: result.provider })
      : result.outcome === 'missing-information' ? t('noAnalysis', { language })
      : t('analysisSource', { language, provider: result.provider });
  })();
  analysisStatus.update(statusMessage);
  if (state && snapshot.retentionNotice) { const notice = document.createElement('p'); notice.textContent = isUiMessage(snapshot.retentionMessage) ? uiText(snapshot.retentionMessage) : t('retentionFailed'); analysis.append(notice); }
  analysis.setAttribute('aria-busy', String(state?.status === 'loading'));
  dictionaryAnnouncements.update(key, state?.status === 'complete' ? state.analysis.candidates : [], snapshot.dictionaries ?? {});
  if (state?.status === 'complete') {
    const result = state.analysis;
    const recovery = providerFeedback(result.providerIssues, result.provider); if (recovery) analysis.append(recovery);
    for (const [candidateIndex, candidate] of result.candidates.entries()) {
      const section = document.createElement('section'); section.className = 'candidate';
      const heading = document.createElement('h3'); heading.textContent = candidate.lemma ?? t('headwordUnavailable');
      section.append(heading);
      const interpretations = document.createElement('ul'); interpretations.className = 'grammar';
      for (const grammar of candidate.grammar?.length ? candidate.grammar.map(value => describeGrammar(value)) : candidate.interpretations) { const item = document.createElement('li'); item.textContent = grammar; interpretations.append(item); }
      if (candidate.interpretations.length) section.append(interpretations);
      for (const meaning of candidate.meanings) { const paragraph = document.createElement('p'); paragraph.textContent = meaning; if (result.explanationLanguage) paragraph.lang = result.explanationLanguage; section.append(paragraph); }
      if (candidate.missing?.length) { const missing = document.createElement('p'); missing.className = 'missing'; missing.textContent = t('missingFields', { fields: candidate.missingMessages?.length ? candidate.missingMessages.map(uiText).join(', ') : currentLocale() === 'en' ? candidate.missing.join(', ') : t('missingInformation') }); section.append(missing); }
      section.append(renderDictionary(snapshot.dictionaries?.[candidateIndex], candidateIndex, (type, extra = {}) => {
        void send({ type, generation: state.generation, candidateIndex, ...extra }).then(refresh).catch(report);
      }, state.identity.explanationLanguage));
      analysis.append(section);
    }
  }
  if (state && state.status !== 'complete' && state.status !== 'loading') {
    const recovery = providerFeedback(state.providerIssues); if (recovery) analysis.append(recovery);
  }
  if (focusId && document.activeElement === document.body) {
    (document.getElementById(focusId) ?? document.getElementById(`${focusId}-region`))?.focus({ preventScroll: true });
  }
  const retry = element<HTMLButtonElement>('retry');
  retry.hidden = state?.status !== 'error';
  retry.textContent = t('retryLookup', { language });
  retry.onclick = () => { void send({ type: 'retry', generation: state?.generation }).then(refresh).catch(report); };
  const missingAccess = [...snapshot.routes.analysis, ...snapshot.routes.dictionary].some(provider => !snapshot.providerGrants[provider.declaration.id]);
  element('provider-settings').hidden = !missingAccess;
  const focusKey = `${tabId}:${snapshot.focusRequest}`;
  if (snapshot.focusRequest && focusKey !== focused) { focused = focusKey; results.focus({ preventScroll: true }); }
  element('enable-current').hidden = !origin || snapshot.readingAccess;
  if (origin) element('enable-current').setAttribute('aria-label', t('enableSiteLabel', { origin }));
  window.scrollTo(scroll.x, scroll.y);
  requestAnimationFrame(() => { if (current === revision) restoringScroll = false; });
}
function enable(value: string): void {
  const site = readingOrigin(value);
  if (!site) { report(new UiError(message('originInvalid'))); return; }
  // Request synchronously from the explicit button gesture, before any awaited work.
  void chrome.permissions.request({ origins: [permissionPattern(site)] }).then(async granted => {
    if (!granted) throw new UiError(message('siteDenied'));
    await send({ type: 'save-origin', origin: site, enabled: true });
    showFeedback(message('enabledSite', { origin: site })); await refresh();
  }).catch(report);
}
element('lookup').addEventListener('submit', event => {
  event.preventDefault(); feedbackMessage = undefined; feedback.textContent = '';
  void send({ type: 'manual-lookup', text: word.value }).then(() => { results.focus({ preventScroll: true }); }).catch(report);
});
word.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); element<HTMLFormElement>('lookup').requestSubmit();
  }
});
async function openSettings(): Promise<void> {
  flushScroll();
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  const existing = contexts.some(context => context.documentUrl?.split(/[?#]/)[0] === chrome.runtime.getURL('options.html'));
  // Edge can reuse an about:blank tab in openOptionsPage, clearing its manual result.
  if (existing) await chrome.runtime.openOptionsPage();
  else await chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
}
for (const id of ['open-settings', 'provider-settings']) element(id).onclick = () => { void openSettings().catch(report); };
element('enable-current').onclick = () => { if (origin) enable(origin); };
function flushScroll(): void {
  if (scrollTimer !== undefined) clearTimeout(scrollTimer);
  scrollTimer = undefined;
  const position = pendingScroll; pendingScroll = undefined;
  if (position) void send(position).catch(report);
}
window.addEventListener('scroll', () => {
  if (restoringScroll || displayedGeneration === undefined) return;
  pendingScroll = { type: 'panel-scroll', tabId, generation: displayedGeneration, x: window.scrollX, y: window.scrollY };
  if (scrollTimer !== undefined) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(flushScroll, 100);
}, { passive: true });
window.addEventListener('pagehide', flushScroll);
chrome.tabs.onActivated.addListener(active => {
  if (active.windowId !== windowId || active.tabId === tabId) return;
  flushScroll(); ++revision; tabId = active.tabId;
  displayedGeneration = undefined; displayed = ''; viewport = ''; renderedPassage = ''; restoringScroll = true;
  analysis.replaceChildren(); element('passage').hidden = true; element('retry').hidden = true;
  dictionaryAnnouncements.update(`${tabId}:none`, [], {});
  target.textContent = t('ready'); analysisStatus.update(message('loadingRetained'));
  void refresh().catch(report);
});
function close(): void { flushScroll(); void send({ type: 'close' }).catch(report); }
element('close').onclick = close;
document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); if (!languageView.dismiss()) close(); } });
let panelPort: chrome.runtime.Port | undefined;
function connect(): void {
  if (panelPort) return;
  const port = chrome.runtime.connect({ name: 'panel' });
  panelPort = port;
  port.postMessage({ type: 'ready', windowId });
  port.onDisconnect.addListener(() => { if (panelPort === port) panelPort = undefined; });
}
// A native action can restart the worker after its old port was disconnected.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'panel-present' && message.windowId === windowId) { reply(true); return; }
  if (message?.type !== 'changed' || typeof windowId !== 'number') return;
  connect();
  void refresh().catch(report);
});
void chrome.windows.getCurrent().then(async current => {
  windowId = current.id!;
  connect();
  await refresh();
}).catch(report);
