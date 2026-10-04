import type { State } from '../core/lookup.ts';
import { permissionPattern, readingOrigin } from '../core/origins.ts';
function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const results = element('results'), status = element('status'), target = element('target'), analysis = element('analysis');
const word = element<HTMLInputElement>('word'), feedback = element('feedback');
let windowId: number;
let origin: string | undefined;
let revision = 0, displayed = '', focused = '', tabId = -1;
async function send(message: Record<string, unknown>): Promise<any> {
  const reply = await chrome.runtime.sendMessage({ ...message, windowId, tabId });
  if (reply?.error) throw new Error(reply.error);
  return reply;
}
function report(error: unknown): void { feedback.textContent = String(error); }
async function refresh(): Promise<void> {
  const current = ++revision;
  const snapshot = await send({ type: 'snapshot' });
  if (current !== revision) return;
  tabId = snapshot.tabId; origin = snapshot.origin;
  const state: State | undefined = snapshot.state;
  const key = `${tabId}:${state?.generation ?? 'none'}`;
  if (key !== displayed) { displayed = key; window.scrollTo(0, 0); }
  target.textContent = state?.text || 'Ready to read';
  analysis.replaceChildren();
  status.textContent = !state ? 'Select a word or enter one above.' : state.status === 'loading' ? 'Loading Latin analysis…' : state.status === 'complete' ? state.analysis.provider : state.message;
  results.setAttribute('aria-busy', String(state?.status === 'loading'));
  if (state?.status === 'complete') for (const candidate of state.analysis.candidates) {
    const heading = document.createElement('h3'); heading.textContent = candidate.lemma;
    const description = document.createElement('p'); description.textContent = candidate.interpretations.join('; ');
    analysis.append(heading, description);
  }
  const focusKey = `${tabId}:${snapshot.focusRequest}`;
  if (snapshot.focusRequest && focusKey !== focused) { focused = focusKey; results.focus({ preventScroll: true }); }
  element<HTMLButtonElement>('enable-current').disabled = !origin;
  element('enable-current').textContent = origin ? `Enable ${origin}` : 'Reading-site access unavailable on this surface';
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
element('enable-current').onclick = () => { if (origin) enable(origin); };
element('site').addEventListener('submit', event => { event.preventDefault(); enable(element<HTMLInputElement>('origin').value); });
function close(): void { void send({ type: 'close' }).catch(report); }
element('close').onclick = close;
document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
void chrome.windows.getCurrent().then(async current => {
  windowId = current.id!;
  const port = chrome.runtime.connect({ name: 'panel' });
  port.onMessage.addListener(() => { void refresh().catch(report); });
  await refresh();
}).catch(report);
