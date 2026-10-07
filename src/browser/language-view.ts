import { message, t } from './i18n.ts';
import { errorMessage } from '../i18n/messages.ts';
import { lookupRoutes } from '../core/configuration.ts';
import type { ProviderCatalog, Settings } from '../core/configuration.ts';
import { explanationName, languageName } from './settings-view.ts';
import { LiveStatus } from './live-status.ts';

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function choices(select: HTMLSelectElement, values: readonly { id: string; name: string; disabled?: boolean }[]): void {
  const key = JSON.stringify(values);
  if (select.dataset.choices === key) return;
  select.dataset.choices = key;
  select.replaceChildren(...values.map(value => {
    const item = document.createElement('option'); item.value = value.id; item.textContent = value.name;
    item.disabled = !!value.disabled; return item;
  }));
}
/** Daily preferences share saved configuration; provider drafts live in Settings. */
export class LanguageView {
  #saved?: Settings;
  #catalog?: ProviderCatalog;
  #saving = false;
  #fields = element<HTMLFieldSetElement>('language-controls');
  #lookup = element<HTMLSelectElement>('lookup-language');
  #explanation = element<HTMLSelectElement>('explanation-language');
  #message = new LiveStatus(element('language-message'));
  #save: (lookupLanguage: string, explanationLanguage: string | undefined, revision: string) => Promise<void>;
  constructor(save: (lookupLanguage: string, explanationLanguage: string | undefined, revision: string) => Promise<void>) {
    this.#save = save; this.#fields.disabled = true;
    this.#lookup.onchange = () => { void this.#submit(this.#lookup.value); };
    this.#explanation.onchange = () => { if (this.#saved) void this.#submit(this.#saved.lookupLanguage, this.#explanation.value); };
    element('language-popover').addEventListener('toggle', () => {
      const open = element('language-popover').matches(':popover-open');
      element('language-button').setAttribute('aria-expanded', String(open));
      if (open) this.#lookup.focus({ preventScroll: true });
    });
  }
  update(saved: Settings, catalog: ProviderCatalog): void {
    this.#message.localize();
    this.#saved = saved; this.#catalog = catalog;
    const routes = lookupRoutes(saved, catalog);
    element('active-settings').textContent = t('languageSummary', { lookup: languageName(saved.lookupLanguage, catalog), explanation: explanationName(routes.explanationLanguage) });
    element('language-button').setAttribute('aria-label', t('languageButton', { lookup: languageName(saved.lookupLanguage, catalog), explanation: explanationName(routes.explanationLanguage) }));
    if (!this.#saving) { this.#fields.disabled = false; this.#render(); }
  }
  #render(): void {
    if (!this.#saved || !this.#catalog) return;
    const routes = lookupRoutes(this.#saved, this.#catalog);
    choices(this.#lookup, this.#catalog.languages.map(language => ({ ...language, name: languageName(language.id, this.#catalog!) })));
    this.#lookup.value = this.#saved.lookupLanguage;
    const explanations = routes.explanationChoices.map(id => ({ id, name: explanationName(id), disabled: false }));
    if (!routes.preferenceAvailable) explanations.unshift({ id: routes.explanationLanguage,
      name: t('unavailableName', { name: explanationName(routes.explanationLanguage) }), disabled: true });
    choices(this.#explanation, explanations); this.#explanation.value = routes.explanationLanguage;
    this.#explanation.hidden = explanations.length <= 1;
    element('explanation-label').hidden = this.#explanation.hidden;
    element('explanation-value').hidden = !this.#explanation.hidden;
    element('explanation-value').textContent = t('explanationsValue', { language: routes.preferenceAvailable ? explanationName(routes.explanationLanguage) : t('unavailableName', { name: explanationName(routes.explanationLanguage) }) });
  }
  async #submit(language: string, explanation?: string): Promise<void> {
    if (!this.#saved || this.#saving) return;
    this.#saving = true; this.#fields.disabled = true; this.#message.update(message('saving'));
    try {
      await this.#save(language, explanation, this.#saved.revision);
      this.#message.update(message('saved'));
    } catch (error) { this.#message.update(errorMessage(error)); }
    finally { this.#saving = false; this.#fields.disabled = false; this.#render(); }
  }
  dismiss(): boolean {
    const popover = element('language-popover');
    if (!popover.matches(':popover-open')) return false;
    popover.hidePopover(); element('language-button').focus({ preventScroll: true }); return true;
  }
}
