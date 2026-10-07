import { message } from '../i18n/messages.ts';
import type { UiMessage } from '../i18n/messages.ts';
export const inputLimits = { passage: 4096, word: 256, offeredWords: 256 } as const;
export interface OfferedWord { text: string; start: number; end: number; }
export type PreparedSelection = { words: OfferedWord[] } | { error: string; uiMessage: UiMessage };
const connectors = new Set(["'", '’', '‘', 'ʼ', '＇', '-', '‐', '‑']);
const letterOrNumber = (character: string) => !connectors.has(character) && /[\p{L}\p{N}]/u.test(character);

/** Bounded orthographic word offering, not linguistic segmentation. Offsets are
 * UTF-16 source slices; all user-facing limits count Unicode code points. */
export function prepareSelection(original: string): PreparedSelection {
  let points = 0;
  for (const _character of original) if (++points > inputLimits.passage) {
    return { error: 'Selection exceeds 4,096 Unicode code points. Select less text; nothing was sent.', uiMessage: message('longSelection') };
  }
  const characters = [...original];
  const words: OfferedWord[] = [];
  let offset = 0, start = -1;
  const finish = () => {
    if (start >= 0) words.push({ text: original.slice(start, offset), start, end: offset });
    start = -1;
  };
  for (const [index, character] of characters.entries()) {
    const letter = letterOrNumber(character);
    const mark = start >= 0 && /\p{M}/u.test(character);
    const internalConnector = start >= 0 && connectors.has(character) && letterOrNumber(characters[index + 1] ?? '');
    if (letter || mark || internalConnector) { if (start < 0) start = offset; }
    else finish();
    offset += character.length;
  }
  finish();
  if (!words.length) return { error: 'Select or enter a word containing letters or numbers. Nothing was sent.', uiMessage: message('emptySelection') };
  if (words.length > inputLimits.offeredWords) return { error: 'Selection contains more than 256 offered words. Select a shorter passage; nothing was sent.', uiMessage: message('manyWords') };
  if (words.some(word => [...word.text].length > inputLimits.word)) return { error: 'A word exceeds 256 Unicode code points. Select a shorter word or passage; nothing was sent.', uiMessage: message('longWord') };
  return { words };
}
