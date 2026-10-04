import type { Analysis } from '../core/lookup.ts';
import { RequestFailure, requestLimits } from '../core/requests.ts';

export const latinDictionary = {
  id: 'alpheios-ls', name: 'Lewis & Short', configuration: 'latin-english-1', format: 'key-id-1',
  indexUrl: 'https://repos1.alpheios.net/lexdata/ls/dat/lat-ls-ids.dat',
  articleUrl: 'https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq',
  origins: ['https://repos1.alpheios.net/*'],
} as const;
export interface IndexRow { key: string; entryId: string; line: number; }
export interface DictionaryAlternative {
  dictionary: string;
  entryId: string;
  rows: IndexRow[];
  correspondence: 'unverified';
}
interface ResolutionDetails {
  providerId?: string;
  originalHeadword: string | null;
  provenance: Analysis['candidates'][number]['provenance'];
  stableLemmaId: string | null;
  root: string;
  alternatives: DictionaryAlternative[];
  automaticSelection: null;
  exhaustive: false;
}
export type DictionaryResolution = ResolutionDetails & (
  { status: 'alternatives' | 'unresolved-mapping' } |
  { status: 'confirmed-absence'; evidence: string }
);

/** The integrated format is a UTF-8 key|target row; @ denotes a redirect family. */
export function parseLatinIndex(text: string): IndexRow[] {
  if (new TextEncoder().encode(text).byteLength > requestLimits.indexBytes) {
    throw new RequestFailure('size', 'Dictionary index exceeds the 8 MiB decoded response limit.');
  }
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length) throw new RequestFailure('format', 'Dictionary index is empty.');
  return lines.map((line, offset) => {
    const fields = line.split('|');
    const [key, entryId] = fields;
    if (fields.length !== 2 || !key || /[\u0000-\u001f\u007f]/u.test(key) ||
        !entryId || (entryId !== '@' && !/^n[0-9]+$/.test(entryId))) {
      throw new RequestFailure('format', `Dictionary index has an invalid row at line ${offset + 1}.`);
    }
    return { key, entryId, line: offset + 1 };
  });
}

/** Preserve encounter order; same-spelling candidates are resolved independently. */
export function resolveLatinCandidate(rows: readonly IndexRow[], candidate: Analysis['candidates'][number]): DictionaryResolution {
  const root = candidate.lemma?.split(',')[0]?.trim() ?? '';
  const alternatives = new Map<string, DictionaryAlternative>();
  if (root) for (const row of rows) {
    const prefix = `@${root}`;
    const relevant = row.key === root || row.key === prefix ||
      (row.key.startsWith(prefix) && /^[1-9][0-9]*$/.test(row.key.slice(prefix.length)));
    if (!relevant || row.entryId === '@') continue;
    const alternative = alternatives.get(row.entryId) ?? {
      dictionary: latinDictionary.name, entryId: row.entryId, rows: [], correspondence: 'unverified' as const,
    };
    alternative.rows.push({ ...row });
    alternatives.set(row.entryId, alternative);
  }
  return { status: alternatives.size ? 'alternatives' : 'unresolved-mapping',
    originalHeadword: candidate.lemma, provenance: candidate.provenance, stableLemmaId: candidate.stableId,
    root, alternatives: [...alternatives.values()], automaticSelection: null, exhaustive: false };
}

export const indexCacheKey = `${latinDictionary.id}:${latinDictionary.configuration}:${latinDictionary.format}`;
export const indexCacheLifetimeMs = 24 * 60 * 60 * 1000;
interface CachedIndex { key: string; storedAt: number; text: string; }
export interface IndexStorage {
  read(): Promise<unknown>;
  write(value: CachedIndex): Promise<void>;
}
function cached(value: unknown, now: number): value is CachedIndex {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CachedIndex>;
  return item.key === indexCacheKey && typeof item.text === 'string' &&
    typeof item.storedAt === 'number' && Number.isFinite(item.storedAt) &&
    item.storedAt <= now && now - item.storedAt < indexCacheLifetimeMs;
}

/** No article or selected word is written to this persistent cache. */
export class LatinIndexCache {
  #storage: IndexStorage;
  #now: () => number;
  constructor(storage: IndexStorage, now: () => number = Date.now) { this.#storage = storage; this.#now = now; }
  async get(refresh: () => Promise<string>, signal: AbortSignal): Promise<IndexRow[]> {
    const saved = await this.#storage.read();
    signal.throwIfAborted();
    if (cached(saved, this.#now())) {
      // Validate even persisted data; older/corrupt formats never become trusted rows.
      try { return parseLatinIndex(saved.text); }
      catch (error) { if (!(error instanceof RequestFailure)) throw error; }
    }
    const text = await refresh();
    signal.throwIfAborted();
    const rows = parseLatinIndex(text);
    await this.#storage.write({ key: indexCacheKey, storedAt: this.#now(), text });
    signal.throwIfAborted();
    return rows;
  }
}
