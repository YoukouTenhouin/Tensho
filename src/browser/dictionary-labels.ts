import type { DictionaryResolution } from '../providers/latin-index.ts';

/** Keep repeated headwords distinguishable in both the page and announcements. */
export function dictionaryLabels(resolution: DictionaryResolution): Map<string, { heading: string; announcement: string }> {
  const totals = new Map<string, number>(), counts = new Map<string, number>();
  const headword = (alternative: DictionaryResolution['alternatives'][number]) =>
    [...new Set(alternative.rows.map(row => row.key))].join(', ') || resolution.originalHeadword || 'Headword unavailable';
  const label = (alternative: DictionaryResolution['alternatives'][number]) => `${headword(alternative)} · ${alternative.dictionary}`;
  for (const alternative of resolution.alternatives) {
    const key = label(alternative); totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return new Map(resolution.alternatives.map(alternative => {
    const key = label(alternative), index = (counts.get(key) ?? 0) + 1;
    counts.set(key, index);
    const duplicate = (totals.get(key) ?? 0) > 1;
    return [alternative.entryId, { heading: duplicate ? `${key} · Entry ${index}` : key,
      announcement: duplicate ? `${headword(alternative)}, entry ${index}` : headword(alternative) }];
  }));
}
