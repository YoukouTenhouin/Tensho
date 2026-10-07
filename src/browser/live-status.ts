import { uiText } from './i18n.ts';
import type { UiMessage } from '../i18n/messages.ts';
/** Give browser accessibility events from rendering time to settle before speaking. */
export class LiveStatus {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #region: HTMLElement;
  #message?: string | UiMessage;
  constructor(region: HTMLElement) { this.#region = region; }

  localize(): void { if (this.#message !== undefined) this.update(this.#message); }
  reset(): void { clearTimeout(this.#timer); this.#message = undefined; this.#region.textContent = ''; }
  update(value: string | UiMessage): void {
    this.#message = value;
    const message = typeof value === 'string' ? value : uiText(value);
    clearTimeout(this.#timer);
    if (this.#region.textContent === message) return;
    // Orca filters bursts of text events; immediate focus events can also interrupt speech.
    this.#timer = setTimeout(() => { this.#region.textContent = message; }, 300);
  }
}
