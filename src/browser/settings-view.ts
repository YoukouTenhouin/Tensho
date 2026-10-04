import { defaultOptions, lookupRoutes, providerCapability } from '../core/configuration.ts';
import type { ProviderCatalog, ProviderRole, Settings, SettingsDraft } from '../core/configuration.ts';

export function languageName(id: string, catalog: ProviderCatalog): string {
  return catalog.languages.find(language => language.id === id)?.name ?? id;
}
export function explanationName(id: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(id) ?? id; } catch { return id; }
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag); if (text) value.textContent = text; return value;
}
function option(value: string, text: string): HTMLOptionElement {
  const item = node('option', text); item.value = value; return item;
}
/** Keeps an explicit draft separate from the saved configuration used by results. */
export class SettingsView {
  #save: (draft: SettingsDraft, revision: string) => Promise<void>;
  #saved?: Settings;
  #draft?: SettingsDraft;
  #catalog!: ProviderCatalog;
  #dirty = false;
  #saving = false;
  #baseRevision = '';
  #message = node('p');
  #fields = node('fieldset');
  #lookup = node('select');
  #explanations = node('select');
  #providers = node('div');
  #apply = node('button', 'Save settings');
  constructor(root: HTMLElement, save: (draft: SettingsDraft, revision: string) => Promise<void>) {
    this.#save = save;
    const form = node('form'); form.id = 'lookup-settings';
    this.#fields.append(node('legend', 'Edit lookup settings'));
    this.#lookup.id = 'lookup-language'; this.#explanations.id = 'explanation-language';
    for (const [labelText, control] of [['Lookup', this.#lookup], ['Explanations', this.#explanations]] as const) {
      const label = node('label', labelText); label.htmlFor = control.id; this.#fields.append(label, control);
    }
    this.#fields.append(this.#providers);
    this.#apply.type = 'submit'; this.#apply.id = 'save-settings';
    const reload = node('button', 'Reload saved settings'); reload.type = 'button'; reload.id = 'reload-settings';
    reload.onclick = () => { if (this.#saved) { this.#dirty = false; this.#reset(); } };
    this.#message.id = 'settings-message'; this.#message.setAttribute('role', 'status');
    this.#fields.append(this.#apply, reload); form.append(this.#fields, this.#message); root.append(form);
    this.#lookup.onchange = () => {
      if (!this.#draft) return;
      this.#draft.lookupLanguage = this.#lookup.value; this.#changed(); this.#profile();
    };
    this.#explanations.onchange = () => {
      if (!this.#draft) return;
      this.#draft.languages[this.#draft.lookupLanguage]!.explanationLanguage = this.#explanations.value; this.#changed();
    };
    form.onsubmit = event => { event.preventDefault(); void this.#submit(); };
  }
  update(saved: Settings, catalog: ProviderCatalog): void {
    this.#catalog = catalog; this.#saved = saved;
    if (!this.#draft || (!this.#dirty && this.#baseRevision !== saved.revision)) this.#reset();
    else if (this.#dirty && this.#baseRevision !== saved.revision && !this.#saving) {
      this.#message.textContent = 'Settings changed in another panel. Reload saved settings before editing again.';
    }
  }
  #changed(): void {
    this.#dirty = true; this.#apply.disabled = false;
    this.#message.textContent = 'Unsaved changes. Results continue to use the saved settings shown above until you save.';
  }
  #reset(): void {
    if (!this.#saved) return;
    this.#baseRevision = this.#saved.revision; this.#draft = structuredClone(this.#saved);
    this.#lookup.replaceChildren(...this.#catalog.languages.map(language => option(language.id, language.name)));
    this.#lookup.value = this.#draft.lookupLanguage;
    this.#apply.disabled = true; this.#message.textContent = 'Changes apply when saved and refresh the visible selection.';
    this.#profile();
  }
  #explanationChoices(): void {
    if (!this.#draft) return;
    const routes = lookupRoutes(this.#draft, this.#catalog);
    const choices = routes.explanationChoices.map(id => option(id, explanationName(id)));
    if (!routes.preferenceAvailable) {
      const unavailable = option(routes.explanationLanguage, `${explanationName(routes.explanationLanguage)} (unavailable)`);
      unavailable.disabled = true; choices.unshift(unavailable);
    }
    this.#explanations.replaceChildren(...choices); this.#explanations.value = routes.explanationLanguage;
  }
  #profile(): void {
    if (!this.#draft) return;
    this.#explanationChoices(); this.#providers.replaceChildren();
    const language = this.#draft.lookupLanguage, profile = this.#draft.languages[language]!;
    for (const role of ['analysis', 'dictionary'] as const) {
      const section = node('section'); section.append(node('h3', role === 'analysis' ? 'Analysis providers' : 'Dictionary providers'));
      // An integrated provider can be added after an older saved configuration.
      for (const provider of this.#catalog.providers) if (providerCapability(this.#catalog, provider.id, language, role) && !profile[role].some(item => item.id === provider.id)) {
        profile[role].push({ id: provider.id, enabled: false, options: defaultOptions(provider) });
      }
      if (!profile[role].length) section.append(node('p', 'No integrated provider is available for this role and lookup language.'));
      const list = node('ol');
      profile[role].forEach((configured, index) => {
        const declared = providerCapability(this.#catalog, configured.id, language, role);
        const item = node('li'), label = node('label'), enabled = node('input');
        enabled.type = 'checkbox'; enabled.checked = configured.enabled;
        enabled.id = `provider-${role}-${index}`;
        const name = declared?.provider.name ?? `${configured.id} (unavailable)`;
        label.append(enabled, document.createTextNode(` ${name}`)); item.append(label);
        enabled.onchange = () => { configured.enabled = enabled.checked; this.#changed(); this.#explanationChoices(); };
        for (const [step, title] of [[-1, 'Move earlier'], [1, 'Move later']] as const) {
          const move = node('button', title); move.type = 'button'; move.disabled = index + step < 0 || index + step >= profile[role].length;
          move.setAttribute('aria-label', `${title}: ${name} for ${role}`);
          move.onclick = () => this.#move(role, index, step);
          item.append(move);
        }
        if (declared) {
          item.append(node('p', `Input: ${declared.capability.inputNotations.join(', ')}. Explanations: ${declared.capability.explanationLanguages.map(explanationName).join(', ') || 'none'}.`));
          for (const [key, declaration] of Object.entries(declared.provider.options)) {
            const optionLabel = node('label', declaration.label);
            const input = declaration.type === 'boolean' ? node('input') : node('select');
            if (input instanceof HTMLInputElement) { input.type = 'checkbox'; input.checked = configured.options[key] === true; }
            else if (declaration.type === 'choice') { input.append(...declaration.choices.map(value => option(value, value))); input.value = String(configured.options[key]); }
            input.onchange = () => { configured.options[key] = input instanceof HTMLInputElement ? input.checked : input.value; this.#changed(); };
            optionLabel.append(input); item.append(optionLabel);
          }
          const credits = node('details'); credits.append(node('summary', 'Provider attribution'), ...declared.provider.attribution.map(text => node('p', text))); item.append(credits);
        }
        list.append(item);
      });
      section.append(list); this.#providers.append(section);
    }
  }
  #move(role: ProviderRole, index: number, step: number): void {
    const entries = this.#draft!.languages[this.#draft!.lookupLanguage]![role];
    [entries[index], entries[index + step]] = [entries[index + step]!, entries[index]!];
    this.#changed(); this.#profile();
    this.#providers.querySelector<HTMLInputElement>(`#provider-${role}-${index + step}`)?.focus();
  }
  async #submit(): Promise<void> {
    if (!this.#draft || this.#saving) return;
    this.#saving = true; this.#fields.disabled = true; this.#message.textContent = 'Saving settings…';
    try {
      await this.#save(structuredClone(this.#draft), this.#baseRevision);
      this.#dirty = false; this.#reset(); this.#message.textContent = 'Settings saved. The visible selection uses the new settings.';
    } catch (error) { this.#message.textContent = error instanceof Error ? error.message : String(error); }
    finally { this.#saving = false; this.#fields.disabled = false; }
  }
}
