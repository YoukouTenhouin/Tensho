// Controlled adapters are build-time fixtures only. Coordination, permissions,
// routing, request bounds, settings and sidebar UI remain production code.
import type { createIntegratedProviders as production } from '../../src/providers/integrated.ts';
import type { Analysis } from '../../src/core/lookup.ts';
import { RequestFailure } from '../../src/core/requests.ts';
import type { DictionaryResolution } from '../../src/providers/latin-index.ts';
import { providerCatalog } from './recovery_catalog.ts';
const scope = globalThis as typeof globalThis & { __tenshoRecoveryScenario?: string; __tenshoRecoveryCalls?: string[] };
export const createIntegratedProviders: typeof production = dependencies => {
  const registry: ReturnType<typeof production> = { analyzers: {}, dictionaries: {} };
  for (const declaration of providerCatalog.providers) {
    const id = declaration.id;
    if (id.startsWith('a-')) registry.analyzers[id] = { analyze: async (text, _identity, signal, deadline) => dependencies.executor.run(async () => {
      (scope.__tenshoRecoveryCalls ??= []).push(`${id}:analysis:${text}`);
      if (text === 'i18npending') await new Promise(resolve => setTimeout(resolve, 2000));
      if (text === 'sessionpending') await new Promise(resolve => setTimeout(resolve, 500));
      const scenario = scope.__tenshoRecoveryScenario;
      if (scenario === 'analysis-exhausted' || (id === 'a-first' && scenario === 'analysis-fallback')) throw new RequestFailure('network', `${id} controlled network failure`);
      if (scenario === 'analysis-empty') return { provider: id, controlled: true, outcome: 'no-match', candidates: [] };
      return { provider: id, controlled: true, outcome: 'usable', candidates: [{ lemma: 'malum', stableId: 'candidate-one',
        grammar: [{ pofs: 'noun', case: 'nominative', num: 'singular' }],
        interpretations: ['Part of speech: noun'], meanings: scenario === 'analysis-partial' ? [] : ['Controlled short meaning'] }] } satisfies Analysis;
    }, { signal, deadline }) };
    else registry.dictionaries[id] = {
      resolve: async (candidate, _identity, signal, deadline) => dependencies.executor.run(async () => {
        (scope.__tenshoRecoveryCalls ??= []).push(`${id}:resolve:${candidate.stableId}`);
        const scenario = scope.__tenshoRecoveryScenario;
        if (id === 'd-first' && scenario === 'dictionary-resolve') throw new RequestFailure('http', 'd-first controlled HTTP failure');
        if (id === 'd-second' && scenario === 'deadline') return new Promise<DictionaryResolution>(() => {});
        const base = { originalHeadword: candidate.lemma, stableLemmaId: candidate.stableId, provenance: candidate.provenance,
          root: 'malum', automaticSelection: null, exhaustive: false } as const;
        if (scenario === 'absence') return { ...base, status: 'confirmed-absence', alternatives: [], evidence: 'Controlled authoritative absence' };
        if (scenario === 'unresolved') return { ...base, status: 'unresolved-mapping', alternatives: [] };
        return { ...base, status: 'alternatives', alternatives: ['n1', 'n2'].map(entryId => ({ dictionary: id, entryId,
          rows: [{ key: 'malum', entryId, line: 1 }], correspondence: 'unverified' })) };
      }, { signal, deadline }),
      retrieve: async (_resolution, entryId, _identity, signal, deadline) => dependencies.executor.run(async () => {
        (scope.__tenshoRecoveryCalls ??= []).push(`${id}:article:${entryId}`);
        const scenario = scope.__tenshoRecoveryScenario;
        if (id === 'd-first' && scenario === 'deadline') return new Promise<never>(() => {});
        if (id === 'd-first' && (scenario === 'article-fallback' || (scenario === 'article-partial' && entryId === 'n2'))) {
          throw new RequestFailure('identity-mismatch', 'd-first controlled article identity mismatch');
        }
        const paragraph = `Complete ${id} ${entryId} article. Latin mālum and Greek ἅμα remain intact.`;
        const paragraphs = scenario === 'session-overflow' ? ['x'.repeat(6 * 1024 * 1024)]
          : scenario === 'session-long' ? Array.from({ length: 100 }, (_, index) => `${index + 1}. ${paragraph}`) : [paragraph];
        return { dictionary: id, entryId, paragraphs,
          attribution: ['Controlled fixture credit'], sourceUrl: `https://fixture.invalid/${id}/${entryId}`, links: [] };
      }, { signal, deadline }),
    };
  }
  return registry;
};
