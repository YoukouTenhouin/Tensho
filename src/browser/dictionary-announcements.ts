import type { CandidateDictionary } from '../core/dictionary.ts';
import { dictionaryLabels } from './dictionary-labels.ts';
import { dictionaryOutcome, failureText } from './result-status.ts';
import type { Analysis } from '../core/lookup.ts';

/** Keep live updates outside the dictionary subtree that rendering replaces. */
export class DictionaryAnnouncements {
  #region: Pick<HTMLElement, 'textContent'>;
  #identity = '';
  #previous = new Map<string, string>();
  #pending = new Map<string, string>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  constructor(region: Pick<HTMLElement, 'textContent'>) { this.#region = region; }

  update(identity: string, candidates: Analysis['candidates'], dictionaries: Record<number, CandidateDictionary>): void {
    const messages = new Map<string, string>();
    for (const [index, candidate] of Object.entries(dictionaries)) {
      const label = `Dictionary for ${candidates[Number(index)]?.lemma ?? `candidate ${Number(index) + 1}`}`;
      const work = candidate.resolution;
      const resolution = work.status === 'loading' ? 'Loading entries.'
        : work.status !== 'complete' ? failureText(work)
        : work.value.status === 'alternatives' ? `${work.value.alternatives.length} possible entries available.`
        : dictionaryOutcome(work.value.status);
      messages.set(`${index}:resolution`, `${label}: ${resolution}`);
      const labels = work.status === 'complete' ? dictionaryLabels(work.value) : undefined;
      for (const [entryId, article] of Object.entries(candidate.articles)) {
        const message = article.status === 'loading' ? 'Loading entry.'
          : article.status === 'complete' ? `Entry from ${article.value.dictionary} is ready.` : article.status === 'not-retained' ? 'Entry too large to retain.' : failureText(article);
        const headword = labels?.get(entryId)?.announcement ?? 'entry';
        messages.set(`${index}:article:${entryId}`, `${label}, ${headword}: ${message}`);
      }
    }
    if (identity !== this.#identity) {
      // Restored content is available for navigation; it is not a new action.
      clearTimeout(this.#timer); this.#pending.clear();
      this.#identity = identity; this.#previous = messages; this.#region.textContent = ''; return;
    }
    const changed = [...messages].filter(([key, message]) => this.#previous.get(key) !== message);
    this.#previous = messages;
    for (const key of this.#pending.keys()) if (!messages.has(key)) this.#pending.delete(key);
    clearTimeout(this.#timer);
    for (const [key, message] of changed) this.#pending.set(key, message);
    if (this.#pending.size) {
      // Orca filters text events within 100 ms of other application text changes.
      // Announce after rendering settles, retaining the latest state per operation.
      this.#timer = setTimeout(() => {
        this.#region.textContent = [...this.#pending.values()].join(' ');
        this.#pending.clear();
      }, 300);
    }
  }
}
