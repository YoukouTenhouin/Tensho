import { RequestFailure } from '../core/requests.ts';

export const whitaker = {
  id: 'alpheios-whitakerLat', name: 'Whitaker via Alpheios',
  lookupLanguages: ['lat'], explanationLanguages: ['en'], roles: ['analysis'],
  endpoint: 'https://morph.alpheios.net/api/v1/analysis/word',
  origins: ['https://morph.alpheios.net/*'],
} as const;

type RecordValue = Record<string, unknown>;
export interface LatinCandidate {
  lemma: string | null;
  stableId: null;
  meanings: string[];
  grammar: RecordValue[];
  lemmaFeatures: RecordValue;
  provenance: { provider: string; bodyReference: string | null; annotationIndex: number; bodyIndex: number; entryIndex: number };
  missing: string[];
}
export interface LatinAnalysis {
  provider: string;
  lookupLanguage: 'lat';
  explanationLanguage: 'en';
  outcome: 'usable' | 'no-match' | 'missing-information';
  candidates: LatinCandidate[];
  attribution: string[];
  excludedForeignRecords: number;
}
function record(value: unknown): value is RecordValue { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function object(value: unknown, field: string): RecordValue {
  if (!record(value)) throw new RequestFailure('format', `Provider returned invalid ${field}.`);
  return value;
}
function many(value: unknown, field: string): RecordValue[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(item => object(item, field));
}
function text(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  return record(value) && typeof value.$ === 'string' ? value.$ || null : null;
}
function foreign(value: RecordValue | undefined): boolean {
  const language = text(value?.lang) ?? text(value?.['xml:lang']);
  return language !== null && language !== 'lat' && language !== 'la';
}

/** Provider-owned boundaries and grammar are retained; no linguistic inference. */
export function normalizeWhitaker(raw: unknown): LatinAnalysis {
  const rdf = object(object(raw, 'response').RDF, 'RDF');
  const annotations = many(rdf.Annotation, 'annotation');
  if (!annotations.length) throw new RequestFailure('format', 'Provider response has no annotation.');
  const result: LatinAnalysis = { provider: whitaker.name, lookupLanguage: 'lat', explanationLanguage: 'en',
    outcome: 'no-match', candidates: [], attribution: [], excludedForeignRecords: 0 };
  let suppliedBodies = false;
  for (const [annotationIndex, annotation] of annotations.entries()) {
    for (const rights of many(annotation.rights, 'attribution')) {
      const credit = text(rights);
      if (credit && !result.attribution.includes(credit)) result.attribution.push(credit);
    }
    const bodies = many(annotation.Body, 'body');
    if (!bodies.length && (annotation.hasBody !== undefined || (!text(annotation.about) && !record(annotation.hasTarget)))) {
      throw new RequestFailure('format', 'Provider response does not establish a valid empty analysis.');
    }
    for (const [bodyIndex, body] of bodies.entries()) {
      suppliedBodies = true;
      if (foreign(annotation) || foreign(body)) { result.excludedForeignRecords++; continue; }
      const rest = body.rest === undefined ? {} : object(body.rest, 'body contents');
      const entries = many(rest.entry, 'entry');
      // A supplied candidate without fields remains visibly incomplete, not absent.
      if (!entries.length) entries.push({});
      for (const [entryIndex, entry] of entries.entries()) {
        const dict = entry.dict === undefined ? {} : object(entry.dict, 'lemma features');
        const headword = entry.dict === undefined || dict.hdwd === undefined ? undefined : object(dict.hdwd, 'headword');
        if (foreign(entry) || foreign(dict) || foreign(headword)) { result.excludedForeignRecords++; continue; }
        const grammar = many(entry.infl, 'grammatical interpretation').filter(interpretation => {
          const term = interpretation.term === undefined ? undefined : object(interpretation.term, 'inflected term');
          if (foreign(interpretation) || foreign(term)) { result.excludedForeignRecords++; return false; }
          return true;
        });
        const meanings = many(entry.mean, 'short meaning').flatMap(meaning => {
          const language = text(meaning.lang) ?? text(meaning['xml:lang']);
          const value = text(meaning);
          return value && (language === null || language === 'en' || language === 'eng') ? [value] : [];
        });
        const lemma = text(headword);
        result.candidates.push({ lemma, stableId: null, meanings, grammar, lemmaFeatures: dict,
          provenance: { provider: whitaker.id, bodyReference: text(body.about), annotationIndex, bodyIndex, entryIndex },
          missing: [...(!lemma ? ['headword'] : []), ...(!grammar.length ? ['grammatical interpretations'] : []), ...(!meanings.length ? ['English short meanings'] : [])] });
      }
    }
  }
  result.outcome = result.candidates.some(candidate => candidate.lemma || candidate.grammar.length || candidate.meanings.length)
    ? 'usable' : suppliedBodies ? 'missing-information' : 'no-match';
  return result;
}
