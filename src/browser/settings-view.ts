import { displayLanguage, localize, message, t, uiText } from './i18n.ts';
import { errorMessage } from '../i18n/messages.ts';
import type { UiMessage } from '../i18n/messages.ts';
import { LiveStatus } from './live-status.ts';
import { lookupRoutes, providerCapability } from '../core/configuration.ts';
import type { ProviderCatalog, ProviderRole, Settings, SettingsDraft } from '../core/configuration.ts';

export function languageName(id: string, catalog: ProviderCatalog): string {
  return displayLanguage(id, catalog.languages.find(language => language.id === id)?.name ?? id);
}
export function explanationName(id: string): string {
  return displayLanguage(id);
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string | UiMessage): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag); if (text) { value.textContent = typeof text === 'string' ? text : uiText(text); if (typeof text !== 'string') value.dataset.i18n = text.id; } return value;
}
function option(value: string, text: string): HTMLOptionElement {
  const item = node('option', text); item.value = value; return item;
}
/** Keeps an explicit draft separate from the saved configuration used by results. */
export class SettingsView {
  #save: (draft: SettingsDraft, revision: string) => Promise<Settings>;
  #root: HTMLElement;
  #saved?: Settings;
  #draft?: SettingsDraft;
  #catalog!: ProviderCatalog;
  #dirty = false;
  #saving = false;
  #baseRevision = '';
  #message = node('p');
  #announcement = new LiveStatus(this.#message);
  #fields = node('fieldset');
  #language = node('select');
  #explanations = node('select');
  #providers = node('div');
  #editingLanguage = '';
  #explanationValue = node('p');
  #explanationLabel = node('label', message('explanations'));
  #discard = node('button', message('discard'));
  #apply = node('button', message('saveChanges'));
  constructor(root: HTMLElement, save: (draft: SettingsDraft, revision: string) => Promise<Settings>) {
    this.#root = root; this.#save = save; this.#fields.disabled = true;
    const form = node('form'); form.id = 'lookup-settings';
    this.#fields.append(node('legend', message('profiles')));
    this.#language.id = 'profile-language'; this.#explanations.id = 'explanation-language';
    const languageLabel = node('label', message('language')); languageLabel.htmlFor = this.#language.id;
    this.#explanationLabel.htmlFor = this.#explanations.id;
    const controls = node('div'); controls.className = 'profile-controls';
    const languageControl = node('div'); languageControl.append(languageLabel, this.#language);
    const explanationControl = node('div');
    this.#explanationValue.id = 'explanation-value';
    explanationControl.append(this.#explanationLabel, this.#explanations, this.#explanationValue);
    controls.append(languageControl, explanationControl); this.#fields.append(controls);
    this.#fields.append(this.#providers);
    this.#apply.type = 'submit'; this.#apply.id = 'save-settings';
    this.#discard.type = 'button'; this.#discard.id = 'reload-settings';
    this.#discard.onclick = () => { if (this.#saved) { this.#dirty = false; this.#reset(); } };
    this.#message.id = 'settings-message'; this.#message.setAttribute('aria-live', 'polite'); this.#message.setAttribute('aria-atomic', 'true');
    const actions = node('div'); actions.className = 'row settings-actions'; actions.append(this.#apply, this.#discard);
    this.#fields.append(actions); form.append(this.#fields, this.#message); root.append(form);
    this.#language.onchange = () => {
      if (!this.#draft) return;
      this.#editingLanguage = this.#language.value; this.#profile();
    };
    this.#explanations.onchange = () => {
      if (!this.#draft) return;
      this.#draft.languages[this.#editingLanguage]!.explanationLanguage = this.#explanations.value; this.#changed();
    };
    form.onsubmit = event => { event.preventDefault(); void this.#submit(); };
  }
  update(saved: Settings, catalog: ProviderCatalog): void {
    this.#catalog = catalog; this.#saved = saved; this.#fields.disabled = this.#saving;
    if (!this.#draft || (!this.#dirty && this.#baseRevision !== saved.revision)) this.#reset();
    else if (this.#dirty && this.#baseRevision !== saved.revision && !this.#saving) {
      this.#announcement.update(message('draftConflict'));
    }
  }
  localize(): void {
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
    localize(this.#root);
    if (this.#draft) {
      this.#language.replaceChildren(...this.#catalog.languages.map(language => option(language.id, languageName(language.id, this.#catalog))));
      this.#language.value = this.#editingLanguage; this.#profile();
    }
    this.#announcement.localize();
    if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  }
  #changed(): void {
    this.#dirty = true; this.#apply.disabled = false; this.#discard.disabled = false;
    this.#announcement.update(message('unsaved'));
  }
  #reset(): void {
    if (!this.#saved) return;
    this.#baseRevision = this.#saved.revision; this.#draft = structuredClone(this.#saved);
    this.#language.replaceChildren(...this.#catalog.languages.map(language => option(language.id, languageName(language.id, this.#catalog))));
    if (!this.#draft.languages[this.#editingLanguage]) this.#editingLanguage = this.#draft.lookupLanguage;
    this.#language.value = this.#editingLanguage;
    this.#apply.disabled = true; this.#discard.disabled = true; this.#announcement.update('');
    this.#profile();
  }
  #explanationChoices(): void {
    if (!this.#draft) return;
    const routes = lookupRoutes(this.#draft, this.#catalog, this.#editingLanguage);
    const choices = routes.explanationChoices.map(id => option(id, explanationName(id)));
    if (!routes.preferenceAvailable) {
      const unavailable = option(routes.explanationLanguage, t('unavailableOption', { name: explanationName(routes.explanationLanguage) }));
      unavailable.disabled = true; choices.unshift(unavailable);
    }
    this.#explanations.replaceChildren(...choices); this.#explanations.value = routes.explanationLanguage;
    this.#explanations.hidden = choices.length <= 1;
    this.#explanationLabel.hidden = this.#explanations.hidden;
    this.#explanationValue.hidden = !this.#explanations.hidden;
    this.#explanationValue.textContent = t('explanationsValue', { language: routes.preferenceAvailable ? explanationName(routes.explanationLanguage) : t('unavailableName', { name: explanationName(routes.explanationLanguage) }) });
  }
  #profile(): void {
    if (!this.#draft) return;
    this.#explanationChoices(); this.#providers.replaceChildren();
    const language = this.#editingLanguage, profile = this.#draft.languages[language]!;
    for (const role of ['analysis', 'dictionary'] as const) {
      const section = node('section'); section.append(node('h3', t(role === 'analysis' ? 'analysisProviders' : 'dictionaryProviders')));
      if (!profile[role].length) section.append(node('p', t('noProviders')));
      const list = node('ol');
      profile[role].forEach((configured, index) => {
        const declared = providerCapability(this.#catalog, configured.id, language, role);
        const item = node('li'), label = node('label'), enabled = node('input');
        enabled.type = 'checkbox'; enabled.checked = configured.enabled;
        enabled.id = `provider-${role}-${index}`;
        const name = declared?.provider.name ?? t('unavailableOption', { name: configured.id });
        label.append(enabled, document.createTextNode(` ${name}`)); item.append(label);
        enabled.onchange = () => { configured.enabled = enabled.checked; this.#changed(); this.#explanationChoices(); };
        if (profile[role].length > 1) for (const [step, title] of [[-1, t('moveEarlier')], [1, t('moveLater')]] as const) {
          const move = node('button', title); move.type = 'button'; move.disabled = index + step < 0 || index + step >= profile[role].length;
          move.setAttribute('aria-label', t('moveProvider', { direction: title, provider: name, role: t(role === 'analysis' ? 'analysisRole' : 'dictionaryRole') }));
          move.onclick = () => this.#move(role, index, step);
          item.append(move);
        }
        if (declared) {
          for (const [key, declaration] of Object.entries(declared.provider.options)) {
            const optionLabel = node('label', declaration.label);
            const input = declaration.type === 'boolean' ? node('input') : node('select');
            if (input instanceof HTMLInputElement) { input.type = 'checkbox'; input.checked = configured.options[key] === true; }
            else if (declaration.type === 'choice') { input.append(...declaration.choices.map(value => option(value, value))); input.value = String(configured.options[key]); }
            input.onchange = () => { configured.options[key] = input instanceof HTMLInputElement ? input.checked : input.value; this.#changed(); };
            optionLabel.append(input); item.append(optionLabel);
          }
        }
        list.append(item);
      });
      section.append(list); this.#providers.append(section);
    }
  }
  #move(role: ProviderRole, index: number, step: number): void {
    const entries = this.#draft!.languages[this.#editingLanguage]![role];
    [entries[index], entries[index + step]] = [entries[index + step]!, entries[index]!];
    this.#changed(); this.#profile();
    this.#providers.querySelector<HTMLInputElement>(`#provider-${role}-${index + step}`)?.focus();
  }
  async #submit(): Promise<void> {
    if (!this.#draft || this.#saving) return;
    this.#saving = true; this.#fields.disabled = true; this.#announcement.update(message('savingSettings'));
    try {
      this.#saved = await this.#save(structuredClone(this.#draft), this.#baseRevision);
      this.#dirty = false; this.#reset(); this.#announcement.update(message('settingsSaved'));
    } catch (error) { this.#announcement.update(errorMessage(error)); }
    finally { this.#saving = false; this.#fields.disabled = false; }
  }
}
