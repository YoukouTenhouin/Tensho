import type { Analyzer } from './lookup.ts';
/** First vertical slice only: no linguistic claims and no network access. */
export const controlledAnalyzer: Analyzer = {
  async analyze(text, _identity, signal) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 350);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Cancelled')); }, { once: true });
    });
    return { provider: 'Controlled development response', controlled: true,
      candidates: [{ lemma: text, stableId: null, interpretations: ['No linguistic analysis: this is an interaction fixture.'], meanings: [] }] };
  },
};
