import { errorMessage, message, resolveInterfaceLocale, translate, UiError } from '../i18n/messages.ts';
import type { InterfaceLocale, MessageId, UiMessage } from '../i18n/messages.ts';
export { message, UiError };
let locale: InterfaceLocale = resolveInterfaceLocale('auto', typeof chrome !== 'undefined' && chrome.i18n ? chrome.i18n.getUILanguage() : 'en');
export const currentLocale = (): InterfaceLocale => locale;
export const t = (id: MessageId, args?: UiMessage['args']): string => translate(locale, message(id, args));
export function displayLanguage(id: string, fallback = id): string {
  try { return new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(({ lat: 'la', san: 'sa' } as Record<string, string>)[id] ?? id) ?? fallback; }
  catch { return fallback; }
}
export const uiText = (descriptor: UiMessage): string => {
  const args = { ...descriptor.args };
  if (typeof args.language === 'string') args.language = displayLanguage(args.language);
  if (args.role === 'analysis' || args.role === 'dictionary') args.role = t(args.role === 'analysis' ? 'analysisRole' : 'dictionaryRole');
  return translate(locale, { ...descriptor, args });
};
export const errorText = (error: unknown): string => uiText(errorMessage(error));
export function localize(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const id = node.dataset.i18n as MessageId;
    node.textContent = t(id, { brand: t('brand') });
  }
  for (const attribute of ['aria-label', 'title', 'placeholder']) {
    for (const node of root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`) as MessageId));
    }
  }
}
export function setLocale(next: InterfaceLocale): boolean {
  const changed = locale !== next; locale = next;
  if (typeof document === 'undefined') return changed;
  document.documentElement.lang = next;
  if (changed || document.body.hidden) localize();
  document.body.hidden = false;
  return changed;
}
