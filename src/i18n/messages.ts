import english from '../../public/_locales/en/messages.json' with { type: 'json' };
import chinese from '../../public/_locales/zh_CN/messages.json' with { type: 'json' };

export type MessageId = keyof typeof english;
export type InterfaceLocale = 'en' | 'zh-Hans';
export type InterfaceLanguage = 'auto' | InterfaceLocale;
export interface UiMessage { id: MessageId; args?: Record<string, string | number>; }
export const message = (id: MessageId, args?: UiMessage['args']): UiMessage => ({ id, ...(args ? { args } : {}) });
export function isUiMessage(value: unknown): value is UiMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && Object.hasOwn(english, item.id) && (item.args === undefined ||
    !!item.args && typeof item.args === 'object' && !Array.isArray(item.args) &&
    Object.values(item.args).every(value => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)));
}
export function readInterfaceLanguage(value: unknown): InterfaceLanguage {
  return value === 'en' || value === 'zh-Hans' ? value : 'auto';
}
export function resolveInterfaceLocale(preference: InterfaceLanguage, browserLanguage: string): InterfaceLocale {
  if (preference !== 'auto') return preference;
  try {
    const locale = new Intl.Locale(browserLanguage.replaceAll('_', '-')).maximize();
    if (locale.language === 'zh' && locale.script === 'Hans') return 'zh-Hans';
  } catch { /* An unsupported or malformed browser locale uses English. */ }
  return 'en';
}
export const localeNames: Record<InterfaceLocale, string> = { en: 'English', 'zh-Hans': '简体中文' };
export function translate(locale: InterfaceLocale, descriptor: UiMessage): string {
  const catalog: Partial<Record<MessageId, { message: string }>> = locale === 'zh-Hans' ? chinese : english;
  const template = catalog[descriptor.id]?.message || english[descriptor.id].message;
  return template.replace(/\$([a-zA-Z]+)\$/g, (_token, name: string) => {
    const value = descriptor.args?.[name];
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value ?? '';
  });
}
export class UiError extends Error {
  readonly uiMessage: UiMessage;
  constructor(uiMessage: UiMessage) { super(translate('en', uiMessage)); this.name = 'UiError'; this.uiMessage = uiMessage; }
}
export function errorMessage(error: unknown): UiMessage {
  if (error && typeof error === 'object' && 'uiMessage' in error && isUiMessage(error.uiMessage)) return error.uiMessage;
  return message('unexpectedError');
}
