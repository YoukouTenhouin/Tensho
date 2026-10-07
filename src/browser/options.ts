import { SettingsView } from './settings-view.ts';
import { latinProviderOrigins } from '../providers/whitaker.ts';
import { permissionPattern, readingOrigin } from '../core/origins.ts';

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
async function send(message: Record<string, unknown>): Promise<any> {
  const reply = await chrome.runtime.sendMessage(message);
  if (reply?.error) throw new Error(reply.error);
  return reply;
}
const feedback = element('feedback');
function report(error: unknown): void { feedback.textContent = error instanceof Error ? error.message : String(error); }
const view = new SettingsView(element('settings-editor'), async (settings, expectedRevision) => {
  const reply = await send({ type: 'save-settings', settings, expectedRevision });
  await refresh(); return reply.settings;
});
let revision = 0, sitesKey = '', creditsKey = '';
async function refresh(): Promise<void> {
  const current = ++revision;
  const snapshot = await send({ type: 'settings-snapshot' });
  if (current !== revision) return;
  view.update(snapshot.settings, snapshot.catalog);
  const [analysis, dictionary] = snapshot.providerAccess as boolean[];
  const decision = snapshot.providerAccessDecision === 'denied' ? 'Access denied. ' :
    snapshot.providerAccessDecision === 'granted' && !(analysis && dictionary) ? 'Access revoked. ' : '';
  element('provider-access').textContent = `${decision}Latin analysis: ${analysis ? 'enabled' : 'disabled'} · Dictionary: ${dictionary ? 'enabled' : 'disabled'}`;
  element<HTMLButtonElement>('enable-providers').hidden = !!(analysis && dictionary);
  const nextSites = JSON.stringify(snapshot.enabledOrigins);
  if (sitesKey !== nextSites) {
    sitesKey = nextSites;
    const list = element('sites'); list.replaceChildren();
    for (const origin of snapshot.enabledOrigins as string[]) {
      const item = document.createElement('li'), name = document.createElement('span'), remove = document.createElement('button');
      name.textContent = origin; remove.textContent = 'Remove'; remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${origin}`);
      remove.onclick = () => {
        remove.disabled = true;
        void send({ type: 'save-origin', origin, enabled: false }).then(refresh).catch(error => { remove.disabled = false; report(error); });
      };
      item.append(name, remove); list.append(item);
    }
    element('sites-empty').hidden = snapshot.enabledOrigins.length > 0;
  }
  const nextCredits = JSON.stringify(snapshot.catalog.providers);
  if (creditsKey !== nextCredits) {
    creditsKey = nextCredits;
    const credits = element('source-credits'); credits.replaceChildren();
    for (const provider of snapshot.catalog.providers) {
      const section = document.createElement('section'), heading = document.createElement('h3');
      heading.textContent = provider.name; section.append(heading);
      for (const credit of provider.attribution) { const text = document.createElement('p'); text.textContent = credit; section.append(text); }
      credits.append(section);
    }
  }
}
element('enable-providers').onclick = () => {
  void chrome.permissions.request({ origins: [...latinProviderOrigins] }).then(async granted => {
    await send({ type: 'provider-access-result' });
    feedback.textContent = granted ? 'Provider access enabled.' : 'Provider access denied.';
    await refresh();
  }).catch(report);
};
element('site').addEventListener('submit', event => {
  event.preventDefault();
  const input = element<HTMLInputElement>('origin'), origin = readingOrigin(input.value);
  if (!origin) { report('Enter an HTTP/HTTPS site origin.'); return; }
  void chrome.permissions.request({ origins: [permissionPattern(origin)] }).then(async granted => {
    if (!granted) throw new Error('Site access denied.');
    await send({ type: 'save-origin', origin, enabled: true });
    input.value = ''; feedback.textContent = 'Site enabled.'; await refresh();
  }).catch(report);
});
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'changed') void refresh().catch(report); });
void refresh().catch(report);
