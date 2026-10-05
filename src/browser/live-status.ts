/** Give browser accessibility events from rendering time to settle before speaking. */
export class LiveStatus {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #region: HTMLElement;
  constructor(region: HTMLElement) { this.#region = region; }

  update(message: string): void {
    clearTimeout(this.#timer);
    if (this.#region.textContent === message) return;
    // Orca filters bursts of text events; immediate focus events can also interrupt speech.
    this.#timer = setTimeout(() => { this.#region.textContent = message; }, 300);
  }
}
