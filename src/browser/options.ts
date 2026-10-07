import { SettingsView } from './settings-view.ts';
import { latinProviderOrigins } from '../providers/whitaker.ts';
import { permissionPattern, readingOrigin } from '../core/origins.ts';
import { currentLocale, message, setLocale, t, uiText, UiError } from './i18n.ts';
import { errorMessage, isUiMessage, localeNames, resolveInterfaceLocale } from '../i18n/messages.ts';
import type { UiMessage } from '../i18n/messages.ts';
import { LiveStatus } from './live-status.ts';

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
async function send(message: Record<string, unknown>): Promise<any> {
  const reply = await chrome.runtime.sendMessage(message);
  if (reply?.error) throw new UiError(isUiMessage(reply.uiMessage) ? reply.uiMessage : { id: 'unexpectedError' });
  return reply;
}
const feedback = element('feedback');
let feedbackMessage: UiMessage | undefined;
function report(error: unknown): void { showFeedback(errorMessage(error)); setLocale(currentLocale()); }
function showFeedback(value: UiMessage): void { feedbackMessage = value; feedback.textContent = uiText(value); }
const view = new SettingsView(element('settings-editor'), async (settings, expectedRevision) => {
  const reply = await send({ type: 'save-settings', settings, expectedRevision });
  await refresh(); return reply.settings;
});
const interfaceSelect = element<HTMLSelectElement>('interface-language');
const interfaceStatus = new LiveStatus(element('interface-message'));
interfaceSelect.disabled = true;
let interfaceSaving = false;
let revision = 0, sitesKey = '', creditsKey = '', interfaceKey = '';
async function refresh(): Promise<void> {
  const current = ++revision;
  const snapshot = await send({ type: 'settings-snapshot' });
  if (current !== revision) return;
  const focus = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  const localeChanged = setLocale(snapshot.interfaceLocale);
  view.update(snapshot.settings, snapshot.catalog);
  if (localeChanged) { view.localize(); interfaceStatus.localize(); }
  if (feedbackMessage) feedback.textContent = uiText(feedbackMessage);
  const browserLocale = resolveInterfaceLocale('auto', chrome.i18n.getUILanguage());
  const nextInterfaceKey = `${currentLocale()}:${browserLocale}`;
  if (interfaceKey !== nextInterfaceKey) {
    interfaceKey = nextInterfaceKey;
    interfaceSelect.replaceChildren(...[
      { value: 'auto', text: t('browserDefault', { language: localeNames[browserLocale] }) },
      ...Object.entries(localeNames).map(([value, text]) => ({ value, text })),
    ].map(({ value, text }) => { const option = document.createElement('option'); option.value = value; option.textContent = text; return option; }));
  }
  interfaceSelect.value = snapshot.interfaceLanguage; interfaceSelect.disabled = interfaceSaving;
  const [analysis, dictionary] = snapshot.providerAccess as boolean[];
  const decision = snapshot.providerAccessDecision === 'denied' ? t('accessDenied') :
    snapshot.providerAccessDecision === 'granted' && !(analysis && dictionary) ? t('accessRevoked') : '';
  element('provider-access').textContent = t('providerAccess', { decision, analysis: t(analysis ? 'enabled' : 'disabled'), dictionary: t(dictionary ? 'enabled' : 'disabled') });
  element<HTMLButtonElement>('enable-providers').hidden = !!(analysis && dictionary);
  const nextSites = JSON.stringify([currentLocale(), snapshot.enabledOrigins]);
  if (sitesKey !== nextSites) {
    sitesKey = nextSites;
    const list = element('sites'); list.replaceChildren();
    for (const origin of snapshot.enabledOrigins as string[]) {
      const item = document.createElement('li'), name = document.createElement('span'), remove = document.createElement('button');
      name.textContent = origin; remove.textContent = t('remove'); remove.type = 'button'; remove.id = `remove-${encodeURIComponent(origin)}`;
      remove.setAttribute('aria-label', t('removeOrigin', { origin }));
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
  if (focus && document.activeElement === document.body) document.getElementById(focus)?.focus({ preventScroll: true });
}
interfaceSelect.onchange = () => {
  if (interfaceSaving) return;
  const interfaceLanguage = interfaceSelect.value;
  const restoreFocus = document.activeElement === interfaceSelect;
  interfaceSaving = true; interfaceSelect.disabled = true; interfaceStatus.update(message('saving'));
  void send({ type: 'save-interface-language', interfaceLanguage }).then(async () => {
    await refresh(); interfaceStatus.update(message('interfaceSaved'));
  }).catch(error => { interfaceStatus.update(errorMessage(error)); }).finally(async () => {
    interfaceSaving = false; interfaceSelect.disabled = false;
    await refresh().catch(report);
    if (restoreFocus && document.hasFocus() && document.activeElement === document.body) interfaceSelect.focus({ preventScroll: true });
  });
};
element('enable-providers').onclick = () => {
  void chrome.permissions.request({ origins: [...latinProviderOrigins] }).then(async granted => {
    await send({ type: 'provider-access-result' });
    showFeedback(message(granted ? 'providerEnabled' : 'providerDenied'));
    await refresh();
  }).catch(report);
};
element('site').addEventListener('submit', event => {
  event.preventDefault();
  const input = element<HTMLInputElement>('origin'), origin = readingOrigin(input.value);
  if (!origin) { report(new UiError(message('originInvalid'))); return; }
  void chrome.permissions.request({ origins: [permissionPattern(origin)] }).then(async granted => {
    if (!granted) throw new UiError(message('siteDenied'));
    await send({ type: 'save-origin', origin, enabled: true });
    input.value = ''; showFeedback(message('siteEnabled')); await refresh();
  }).catch(report);
});
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'changed') void refresh().catch(report); });
void refresh().catch(report);
