import { latinProviderOrigins } from '../providers/whitaker.ts';
import type { State } from '../core/lookup.ts';
import { permissionPattern, readingOrigin } from '../core/origins.ts';
import { renderDictionary } from './dictionary-view.ts';
import { SettingsView, languageName, explanationName } from './settings-view.ts';
function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const results = element('results'), status = element('status'), target = element('target'), analysis = element('analysis');
const word = element<HTMLTextAreaElement>('word'), feedback = element('feedback');
let windowId: number;
let origin: string | undefined;
let revision = 0, displayed = '', viewport = '', renderedPassage = '', focused = '', sitesKey = '', tabId = -1;
async function send(message: Record<string, unknown>): Promise<any> {
  const reply = await chrome.runtime.sendMessage({ ...message, windowId, tabId });
  if (reply?.error) throw new Error(reply.error);
  return reply;
}
const settingsView = new SettingsView(element('settings-editor'), async (settings, expectedRevision) => {
  const saved = await send({ type: 'save-settings', settings, expectedRevision }); await refresh();
  return saved.settings;
});
function report(error: unknown): void { feedback.textContent = String(error); }
async function refresh(): Promise<void> {
  const current = ++revision;
  const snapshot = await send({ type: 'snapshot' });
  if (current !== revision) return;
  tabId = snapshot.tabId; origin = snapshot.origin;
  const language = languageName(snapshot.settings.lookupLanguage, snapshot.catalog);
  const explanation = snapshot.settings.languages[snapshot.settings.lookupLanguage].explanationLanguage;
  const explanationLabel = explanationName(explanation);
  element('active-settings').textContent = `Lookup: ${language} · Explanations: ${explanationLabel}${snapshot.routes.preferenceAvailable ? '' : ' (unavailable)'}`;
  settingsView.update(snapshot.settings, snapshot.catalog);
  element('configuration-status').textContent = !snapshot.routes.analysis.length
    ? `${language} analysis is unavailable with the current providers.`
    : !snapshot.routes.dictionary.length ? `Dictionary entries are unavailable for ${explanationLabel} with the current providers.`
    : snapshot.routes.analysisMode === 'structural-only' ? `Short meanings are unavailable for ${explanationLabel}; lemmas and grammar remain available.` : '';
  const state: State | undefined = snapshot.state;
  const key = `${tabId}:${state?.generation ?? 'none'}`;
  const focusId = key === displayed && document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  const viewportKey = state?.passage ? `${tabId}:passage:${state.passage.id}` : key;
  if (viewportKey !== viewport) { viewport = viewportKey; window.scrollTo(0, 0); }
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
  status.textContent = !state ? 'Select a word or enter one above.' : state.status === 'loading' ? `Loading ${language} analysis…` : state.status === 'complete' ? state.analysis.provider : state.message;
  analysis.setAttribute('aria-busy', String(state?.status === 'loading'));
  if (state?.status === 'complete') {
    const result = state.analysis;
    if (result.explanationNotice) { const note = document.createElement('p'); note.textContent = result.explanationNotice; analysis.append(note); }
    status.textContent = result.controlled ? result.provider : result.outcome === 'no-match' ? `No ${language} match from ${result.provider}.`
      : result.outcome === 'missing-information' ? `The provider supplied no usable ${language} analysis information.`
      : `${language} analysis — ${result.provider}`;
    for (const [candidateIndex, candidate] of result.candidates.entries()) {
      const section = document.createElement('section');
      const heading = document.createElement('h3'); heading.textContent = candidate.lemma ?? 'Headword unavailable';
      section.append(heading);
      const interpretations = document.createElement('ul');
      for (const grammar of candidate.interpretations) { const item = document.createElement('li'); item.textContent = grammar; interpretations.append(item); }
      section.append(interpretations);
      for (const meaning of candidate.meanings) { const paragraph = document.createElement('p'); paragraph.textContent = meaning; section.append(paragraph); }
      if (candidate.missing?.length) { const missing = document.createElement('p'); missing.textContent = `Not supplied: ${candidate.missing.join(', ')}.`; section.append(missing); }
      section.append(renderDictionary(snapshot.dictionaries?.[candidateIndex], candidateIndex, (type, extra = {}) => {
        void send({ type, generation: state.generation, candidateIndex, ...extra }).then(refresh).catch(report);
      }));
      analysis.append(section);
    }
    if (result.excludedForeignRecords) { const note = document.createElement('p'); note.textContent = 'Records explicitly labelled as another lookup language were excluded.'; analysis.append(note); }
    for (const credit of result.attribution ?? []) { const attribution = document.createElement('p'); attribution.textContent = credit; analysis.append(attribution); }
  }
  if (focusId && document.activeElement === document.body) {
    (document.getElementById(focusId) ?? document.getElementById(`${focusId}-region`))?.focus({ preventScroll: true });
  }
  const retry = element<HTMLButtonElement>('retry');
  retry.hidden = state?.status !== 'error';
  retry.textContent = `Retry ${language} analysis`;
  retry.onclick = () => { void send({ type: 'retry', generation: state?.generation }).then(refresh).catch(report); };
  const [analysisAccess, dictionaryAccess] = snapshot.providerAccess as boolean[];
  const completeAccess = analysisAccess && dictionaryAccess;
  element<HTMLButtonElement>('enable-providers').disabled = !!completeAccess;
  const accessPrefix = snapshot.providerAccessDecision === 'denied' ? 'Access was denied.'
    : snapshot.providerAccessDecision === 'granted' && !completeAccess ? 'Provider access was revoked or reduced.'
    : !analysisAccess && !dictionaryAccess ? 'Provider access has not been granted.' : '';
  element('provider-access').textContent = `${accessPrefix} Latin analysis access: ${analysisAccess ? 'enabled' : 'missing'}. Dictionary access: ${dictionaryAccess ? 'enabled' : 'missing'}.`;
  const focusKey = `${tabId}:${snapshot.focusRequest}`;
  if (snapshot.focusRequest && focusKey !== focused) { focused = focusKey; results.focus({ preventScroll: true }); }
  element<HTMLButtonElement>('enable-current').disabled = !origin;
  element('enable-current').textContent = origin ? `Enable ${origin}` : 'Reading-site access unavailable on this surface';
  const nextSitesKey = JSON.stringify(snapshot.enabledOrigins);
  if (nextSitesKey === sitesKey) return;
  sitesKey = nextSitesKey;
  const list = element('sites'); list.replaceChildren();
  for (const site of snapshot.enabledOrigins as string[]) {
    const item = document.createElement('li'); item.append(document.createTextNode(site));
    const remove = document.createElement('button'); remove.textContent = 'Disable'; remove.setAttribute('aria-label', `Disable ${site}`);
    remove.onclick = () => { void send({ type: 'save-origin', origin: site, enabled: false }).then(refresh).catch(report); };
    item.append(remove); list.append(item);
  }
}
function enable(value: string): void {
  const site = readingOrigin(value);
  if (!site) { report('Enter an ordinary HTTP/HTTPS origin.'); return; }
  // Request synchronously from the explicit button gesture, before any awaited work.
  void chrome.permissions.request({ origins: [permissionPattern(site)] }).then(async granted => {
    if (!granted) throw new Error(`Access to ${site} was denied. Automatic lookup remains disabled.`);
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
element('enable-providers').onclick = () => {
  // Native permission prompting is only initiated by this explicit learner action.
  void chrome.permissions.request({ origins: [...latinProviderOrigins] }).then(async granted => {
    await send({ type: 'provider-access-result' });
    feedback.textContent = granted ? 'Latin provider access enabled. Submit a word or retry the previous lookup.' : 'Latin provider access denied. No lookup was sent.';
    await refresh();
  }).catch(report);
};
element('enable-current').onclick = () => { if (origin) enable(origin); };
element('site').addEventListener('submit', event => { event.preventDefault(); enable(element<HTMLInputElement>('origin').value); });
function close(): void { void send({ type: 'close' }).catch(report); }
element('close').onclick = close;
document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
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
