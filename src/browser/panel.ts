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
  if (reply?.error) throw new Error(reply.error);
  return reply;
}
const languageView = new LanguageView(async (lookupLanguage, explanationLanguage, expectedRevision) => {
  try { await send({ type: 'save-preferences', lookupLanguage, explanationLanguage, expectedRevision }); }
  finally { await refresh(); }
});
function report(error: unknown): void { feedback.textContent = String(error); }
async function refresh(): Promise<void> {
  flushScroll();
  const current = ++revision;
  const snapshot = await send({ type: 'snapshot' });
  if (current !== revision) return;
  tabId = snapshot.tabId; origin = snapshot.origin;
  const language = languageName(snapshot.settings.lookupLanguage, snapshot.catalog);
  const explanation = snapshot.settings.languages[snapshot.settings.lookupLanguage].explanationLanguage;
  const explanationLabel = explanationName(explanation);
  languageView.update(snapshot.settings, snapshot.catalog);
  element('configuration-status').textContent = !snapshot.routes.analysis.length
    ? `${language} analysis unavailable`
    : !snapshot.routes.dictionary.length ? `Dictionary unavailable in ${explanationLabel}`
    : snapshot.routes.analysisMode === 'structural-only' ? `Short meanings unavailable in ${explanationLabel}` : '';
  const state: State | undefined = snapshot.state;
  const key = `${tabId}:${state?.generation ?? 'none'}`;
  const focusId = key === displayed && document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  const viewportKey = key;
  const scroll = viewportKey !== viewport ? snapshot.scroll ?? { x: 0, y: 0 } : { x: window.scrollX, y: window.scrollY };
  viewport = viewportKey; displayedGeneration = state?.generation; restoringScroll = true;
  displayed = key;
  const passage = state?.passage;
  const passageKey = passage ? `${tabId}:${passage.id}` : '';
  element('passage').hidden = !passage;
  if (passageKey !== renderedPassage) {
    renderedPassage = passageKey;
    element('passage-original').textContent = passage?.original ?? '';
    const controls = element('passage-words'); controls.replaceChildren();
    passage?.words.forEach((offered, wordIndex) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = offered.text;
      button.id = `passage-word-${wordIndex}`;
      button.setAttribute('aria-label', `Look up ${offered.text} (word ${wordIndex + 1} of ${passage.words.length})`);
      button.onclick = () => { void send({ type: 'passage-word', passageId: passage.id, wordIndex }).then(refresh).catch(report); };
      controls.append(button);
    });
  }
  for (const [index, button] of Array.from(element('passage-words').querySelectorAll('button')).entries()) {
    button.setAttribute('aria-pressed', String(index === passage?.selectedIndex));
  }
  target.textContent = passage && passage.selectedIndex === undefined ? 'Choose a word' : state?.text || 'Ready to read';
  analysis.replaceChildren();
  const statusMessage = (() => {
    if (!state) return snapshot.retentionNotice ?? '';
    if (state.status === 'loading') return `Loading ${language} analysis…`;
    if (state.status !== 'complete') return state.status === 'notice' && state.passage && state.passage.selectedIndex === undefined
      ? 'Choose a word' : failureText(state);
    const result = state.analysis;
    return result.controlled && !result.outcome ? result.provider : result.outcome === 'no-match' ? `No ${language} match from ${result.provider}.`
      : result.outcome === 'missing-information' ? `No ${language} analysis supplied.`
      : `${language} analysis — ${result.provider}`;
  })();
  analysisStatus.update(statusMessage);
  if (state && snapshot.retentionNotice) { const notice = document.createElement('p'); notice.textContent = snapshot.retentionNotice; analysis.append(notice); }
  analysis.setAttribute('aria-busy', String(state?.status === 'loading'));
  dictionaryAnnouncements.update(key, state?.status === 'complete' ? state.analysis.candidates : [], snapshot.dictionaries ?? {});
  if (state?.status === 'complete') {
    const result = state.analysis;
    const recovery = providerFeedback(result.providerIssues, result.provider); if (recovery) analysis.append(recovery);
    for (const [candidateIndex, candidate] of result.candidates.entries()) {
      const section = document.createElement('section'); section.className = 'candidate';
      const heading = document.createElement('h3'); heading.textContent = candidate.lemma ?? 'Headword unavailable';
      section.append(heading);
      const interpretations = document.createElement('ul'); interpretations.className = 'grammar';
      for (const grammar of candidate.interpretations) { const item = document.createElement('li'); item.textContent = grammar; interpretations.append(item); }
      if (candidate.interpretations.length) section.append(interpretations);
      for (const meaning of candidate.meanings) { const paragraph = document.createElement('p'); paragraph.textContent = meaning; section.append(paragraph); }
      if (candidate.missing?.length) { const missing = document.createElement('p'); missing.className = 'missing'; missing.textContent = `Unavailable: ${candidate.missing.join(', ')}.`; section.append(missing); }
      section.append(renderDictionary(snapshot.dictionaries?.[candidateIndex], candidateIndex, (type, extra = {}) => {
        void send({ type, generation: state.generation, candidateIndex, ...extra }).then(refresh).catch(report);
      }));
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
  retry.textContent = `Retry ${language} lookup`;
  retry.onclick = () => { void send({ type: 'retry', generation: state?.generation }).then(refresh).catch(report); };
  const missingAccess = [...snapshot.routes.analysis, ...snapshot.routes.dictionary].some(provider => !snapshot.providerGrants[provider.declaration.id]);
  element('provider-settings').hidden = !missingAccess;
  const focusKey = `${tabId}:${snapshot.focusRequest}`;
  if (snapshot.focusRequest && focusKey !== focused) { focused = focusKey; results.focus({ preventScroll: true }); }
  element('enable-current').hidden = !origin || snapshot.readingAccess;
  if (origin) element('enable-current').setAttribute('aria-label', `Enable automatic lookup on ${origin}`);
  window.scrollTo(scroll.x, scroll.y);
  requestAnimationFrame(() => { if (current === revision) restoringScroll = false; });
}
function enable(value: string): void {
  const site = readingOrigin(value);
  if (!site) { report('Enter an ordinary HTTP/HTTPS origin.'); return; }
  // Request synchronously from the explicit button gesture, before any awaited work.
  void chrome.permissions.request({ origins: [permissionPattern(site)] }).then(async granted => {
    if (!granted) throw new Error('Site access denied.');
    await send({ type: 'save-origin', origin: site, enabled: true });
    feedback.textContent = `Enabled ${site}`; await refresh();
  }).catch(report);
}
element('lookup').addEventListener('submit', event => {
  event.preventDefault(); feedback.textContent = '';
  void send({ type: 'manual-lookup', text: word.value }).then(() => { results.focus({ preventScroll: true }); }).catch(report);
});
word.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); element<HTMLFormElement>('lookup').requestSubmit();
  }
});
function openSettings(): void { flushScroll(); void chrome.runtime.openOptionsPage().catch(report); }
element('open-settings').onclick = openSettings;
element('provider-settings').onclick = openSettings;
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
  target.textContent = 'Ready to read'; analysisStatus.update('Loading retained result…');
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
