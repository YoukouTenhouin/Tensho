import { errorMessage, message, resolveInterfaceLocale, translate, UiError } from '../i18n/messages.ts';
import type { InterfaceLocale, MessageId, UiMessage } from '../i18n/messages.ts';
export { message, UiError };
let locale: InterfaceLocale = resolveInterfaceLocale('auto', chrome.i18n.getUILanguage());
export const currentLocale = (): InterfaceLocale => locale;
export const t = (id: MessageId, args?: UiMessage['args']): string => translate(locale, message(id, args));
export const uiText = (descriptor: UiMessage): string => translate(locale, descriptor);
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
  document.documentElement.lang = next;
  localize(); document.body.hidden = false;
  return changed;
}
