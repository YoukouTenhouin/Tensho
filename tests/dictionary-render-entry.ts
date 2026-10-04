// Browser acceptance entry, bundled separately; never included in the extension.
import { DictionaryCoordinator } from '../src/core/dictionary.ts';
import { LookupCoordinator } from '../src/core/lookup.ts';
import { createLatinDictionary } from '../src/providers/latin-dictionary.ts';
import { RequestExecutor, RequestFailure } from '../src/core/requests.ts';
import { renderDictionary, renderArticle } from '../src/browser/dictionary-view.ts';
import type { DictionaryResolution } from '../src/providers/latin-index.ts';
import type { Identity } from '../src/core/lookup.ts';

export async function exercise(fixtures: { articles: Record<string, string>; hostile: string }) {
  const identity: Identity = { tabId: 1, frameId: 0, documentId: 'controlled', topDocumentId: 'controlled',
    configuration: 'controlled', lookupLanguage: 'lat', explanationLanguage: 'en' };
  const payloads = { ...fixtures.articles, n999: fixtures.hostile.replace('lemma-id="n27774"', 'lemma-id="n999"') };
  const ids = Object.keys(payloads);
  const index = ids.map(id => `${id}|${id}`).join('\n');
  const requests: string[] = [];
  let stored: unknown;
  const provider = createLatinDictionary({ executor: new RequestExecutor(), permitted: async () => true,
    fetch: async input => {
      const url = new URL(String(input)); requests.push(url.href);
      return new Response(url.pathname.endsWith('.dat') ? index : payloads[url.searchParams.get('n') as keyof typeof payloads]);
    }, storage: { read: async () => stored, write: async value => { stored = value; } } });
  const lookup = new LookupCoordinator({ analyze: async () => ({ provider: 'Controlled reading fixture', controlled: true,
    candidates: ids.map(lemma => ({ lemma, stableId: null, meanings: ['retained analysis'], interpretations: [] })) }) }, () => {});
  const dictionary = new DictionaryCoordinator(provider, tab => lookup.get(tab), () => {}, async () => true);
  await lookup.lookup(identity, 'controlled');
  const analysis = lookup.get(1)!;
  document.body.replaceChildren();
  const articleTexts: Record<string, string[]> = {};
  for (const [i, id] of ids.entries()) {
    await dictionary.resolve(1, analysis.generation, i);
    if (Object.keys(dictionary.get(1)[i]!.articles).length) throw new Error('Eager article retrieval');
    await dictionary.retrieve(1, analysis.generation, i, id);
    const candidate = dictionary.get(1)[i]!;
    const article = candidate.articles[id]!;
    if (article.status !== 'complete') throw new Error(JSON.stringify(article));
    articleTexts[id] = article.value.paragraphs;
    const view = renderDictionary(candidate, i, () => { throw new Error('Unexpected action'); });
    view.dataset.case = id; document.body.append(view);
  }
  const terminal: Record<string, string> = {};
  for (const outcome of ['unresolved-mapping', 'confirmed-absence', 'technical-failure'] as const) {
    const controlled = new DictionaryCoordinator({ resolve: async () => {
      if (outcome === 'technical-failure') throw new RequestFailure('format', 'Controlled identity mismatch.');
      return { status: outcome, evidence: 'controlled provider contract', originalHeadword: 'test', provenance: undefined,
        stableLemmaId: null, root: 'test', alternatives: [], automaticSelection: null, exhaustive: false } satisfies DictionaryResolution;
    }, retrieve: async () => { throw new Error('Terminal outcome must not fetch an article'); } }, tab => lookup.get(tab), () => {}, async () => true);
    await controlled.resolve(1, analysis.generation, 0);
    const view = renderDictionary(controlled.get(1)[0], 100 + Object.keys(terminal).length, () => {});
    terminal[outcome] = view.textContent ?? ''; document.body.append(view);
  }
  // Challenge the renderer separately with deliberately corrupt serialized data.
  document.body.append(renderArticle({ dictionary: 'Controlled hostile data', entryId: 'n0', attribution: [],
    paragraphs: ['<img src=x onerror="window.providerActive++">'],
    links: ['javascript:window.providerActive++', 'data:text/html,boom', 'https://user:pass@example.org/', 'https://example.org/\nonclick=x'],
    sourceUrl: 'javascript:window.providerActive++' }));
  return { articleTexts, terminal, requests, analysisPreserved: lookup.get(1) === analysis };
}
