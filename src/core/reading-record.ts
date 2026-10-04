import type { Analysis, State } from './lookup.ts';
import type { CandidateDictionary } from './dictionary.ts';
import { requestFailureKinds } from './requests.ts';
import { safeHttpsUrl } from './safe-links.ts';

export interface ReadingRecord {
  state: State;
  dictionaries: Record<number, CandidateDictionary>;
  scroll: { x: number; y: number };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const optional = (value: unknown, valid: (value: unknown) => boolean) => value === undefined || valid(value);
const oneOf = (value: unknown, allowed: readonly string[]) => text(value) && allowed.includes(value);
const nullableText = (value: unknown) => value === null || text(value);
const failureKind = (value: unknown) => requestFailureKinds.some(kind => kind === value);
function issues(value: unknown): boolean {
  return Array.isArray(value) && value.every(issue => object(issue) && text(issue.providerId) && text(issue.providerName) &&
    oneOf(issue.operation, ['analysis', 'resolution', 'article']) && failureKind(issue.kind) && text(issue.message) && typeof issue.attempted === 'boolean');
}
function provenance(value: unknown): boolean {
  return object(value) && text(value.provider) && nullableText(value.bodyReference) &&
    integer(value.annotationIndex) && integer(value.bodyIndex) && integer(value.entryIndex);
}
function analysis(value: unknown): boolean {
  return object(value) && text(value.provider) && typeof value.controlled === 'boolean' &&
    optional(value.outcome, outcome => oneOf(outcome, ['usable', 'no-match', 'missing-information'])) &&
    optional(value.attribution, texts) && optional(value.excludedForeignRecords, integer) &&
    optional(value.explanationLanguage, nullableText) && optional(value.explanationNotice, text) && optional(value.providerIssues, issues) &&
    Array.isArray(value.candidates) && value.candidates.every(candidate => object(candidate) && nullableText(candidate.lemma) && nullableText(candidate.stableId) &&
      texts(candidate.interpretations) && texts(candidate.meanings) && optional(candidate.missing, texts) && optional(candidate.provenance, provenance));
}
function state(value: unknown): value is State {
  if (!object(value) || !integer(value.generation) || !text(value.text) || !object(value.identity)) return false;
  const identity = value.identity;
  if (!integer(identity.tabId) || !integer(identity.frameId) || !['documentId', 'topDocumentId', 'configuration', 'lookupLanguage', 'explanationLanguage'].every(key => text(identity[key]) && !!identity[key])) return false;
  if (value.passage !== undefined) {
    const passage = value.passage;
    if (!object(passage) || !integer(passage.id) || !text(passage.original) || !Array.isArray(passage.words) || !passage.words.length) return false;
    if (!passage.words.every(word => object(word) && text(word.text) && integer(word.start) && integer(word.end) && word.end > word.start &&
      word.end <= (passage.original as string).length && (passage.original as string).slice(word.start, word.end) === word.text)) return false;
    if (passage.selectedIndex !== undefined && (!integer(passage.selectedIndex) || passage.selectedIndex >= passage.words.length)) return false;
  }
  if (value.status === 'complete') return analysis(value.analysis);
  return value.status === 'loading' || (oneOf(value.status, ['notice', 'error', 'unavailable']) && text(value.message) &&
    optional(value.failureKind, failureKind) && optional(value.providerIssues, issues));
}
function resolution(value: unknown): boolean {
  return object(value) && oneOf(value.status, ['alternatives', 'unresolved-mapping', 'confirmed-absence']) &&
    (value.status !== 'confirmed-absence' || text(value.evidence)) && nullableText(value.originalHeadword) && nullableText(value.stableLemmaId) &&
    optional(value.provenance, provenance) && text(value.root) && value.automaticSelection === null && value.exhaustive === false &&
    optional(value.providerId, text) && optional(value.providerName, text) && optional(value.providerIssues, issues) &&
    Array.isArray(value.alternatives) && value.alternatives.every(alternative => object(alternative) && text(alternative.dictionary) && text(alternative.entryId) &&
      alternative.correspondence === 'unverified' && Array.isArray(alternative.rows) && alternative.rows.every(row => object(row) && text(row.key) && row.entryId === alternative.entryId && integer(row.line)));
}
function article(value: unknown): boolean {
  return object(value) && text(value.dictionary) && text(value.entryId) && texts(value.paragraphs) && texts(value.attribution) &&
    texts(value.links) && value.links.every(link => !!safeHttpsUrl(link)) && text(value.sourceUrl) && !!safeHttpsUrl(value.sourceUrl) && optional(value.providerIssues, issues);
}
function work(value: unknown, valid: (value: unknown) => boolean): boolean {
  return object(value) && (value.status === 'loading' || (value.status === 'complete' ? valid(value.value) :
    oneOf(value.status, ['error', 'unavailable']) && text(value.message) && optional(value.failureKind, failureKind) && optional(value.providerIssues, issues)));
}

function candidateDictionary(value: unknown, candidate: Analysis['candidates'][number]): boolean {
  if (!object(value) || typeof value.expanded !== 'boolean' || !work(value.resolution, resolution) || !object(value.articles) ||
    !Object.entries(value.articles).every(([entryId, saved]) => work(saved, article) &&
      (!object(saved) || saved.status !== 'complete' || (object(saved.value) && saved.value.entryId === entryId)))) return false;
  // The rendering shapes above are validated before checking their association.
  const saved = value as unknown as CandidateDictionary;
  if (saved.resolution.status !== 'complete') return true;
  const resolved = saved.resolution.value;
  if (resolved.originalHeadword !== candidate.lemma || resolved.stableLemmaId !== candidate.stableId) return false;
  return Object.entries(saved.articles).every(([entryId, article]) => {
    const alternative = resolved.alternatives.find(item => item.entryId === entryId);
    return alternative && (article.status !== 'complete' || article.value.dictionary === alternative.dictionary);
  });
}

/** Session data must satisfy the production rendering contracts before hydration.
 * Document/configuration currency is checked separately against browser state. */
export function isReadingRecord(value: unknown): value is ReadingRecord {
  if (!object(value) || !state(value.state) || !object(value.dictionaries) || !object(value.scroll) ||
    ![value.scroll.x, value.scroll.y].every(position => typeof position === 'number' && Number.isFinite(position) && position >= 0)) return false;
  const candidates = value.state.status === 'complete' ? value.state.analysis.candidates : [];
  return Object.entries(value.dictionaries).every(([index, dictionary]) => /^(0|[1-9][0-9]*)$/.test(index) &&
    Number(index) < candidates.length && candidateDictionary(dictionary, candidates[Number(index)]!));
}
