import type { Analysis, Identity } from '../core/lookup.ts';
import { RequestExecutor, RequestFailure, readBoundedText, requestLimits } from '../core/requests.ts';
import { LatinIndexCache, latinDictionary, resolveLatinCandidate } from './latin-index.ts';
import type { DictionaryResolution, IndexStorage } from './latin-index.ts';
import { extractLatinArticle, latinArticleUrl } from './latin-article.ts';
import type { DictionaryArticle } from './latin-article.ts';

export interface DictionaryProvider {
  resolve(candidate: Analysis['candidates'][number], identity: Identity, signal: AbortSignal, deadline: number): Promise<DictionaryResolution>;
  retrieve(resolution: DictionaryResolution, entryId: string, identity: Identity, signal: AbortSignal, deadline: number): Promise<DictionaryArticle>;
}
export function createLatinDictionary(dependencies: {
  executor: RequestExecutor;
  permitted: (origins: readonly string[]) => Promise<boolean>;
  fetch: typeof fetch;
  storage: IndexStorage;
  now?: () => number;
}): DictionaryProvider {
  const cache = new LatinIndexCache(dependencies.storage, dependencies.now);
  async function guard(identity: Identity, signal: AbortSignal, deadline: number): Promise<void> {
    if (identity.lookupLanguage !== 'lat' || identity.explanationLanguage !== 'en') {
      throw new RequestFailure('format', 'Lewis & Short supports Latin lookup with English explanations.');
    }
    const allowed = await dependencies.permitted(latinDictionary.origins);
    signal.throwIfAborted();
    if (performance.now() >= deadline) throw new RequestFailure('action-deadline', 'Dictionary action exceeded its 30-second deadline.');
    if (!allowed) throw new RequestFailure('missing-access', 'Dictionary access is missing. Enable Latin providers and retry this dictionary action.');
  }
  async function fetchText(url: string, accept: string, limit: number, signal: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await dependencies.fetch(url, { headers: { Accept: accept }, signal, credentials: 'omit',
        referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
    } catch (error) {
      signal.throwIfAborted();
      throw new RequestFailure('network', `Dictionary request failed: ${error instanceof Error ? error.message : 'network error'}`);
    }
    return readBoundedText(response, signal, limit);
  }
  return {
    resolve(candidate, identity, signal, deadline) {
      return dependencies.executor.run(async requestSignal => {
        await guard(identity, requestSignal, deadline);
        const rows = await cache.get(async () => {
          // Storage may have yielded since the first guard. Recheck at dispatch.
          await guard(identity, requestSignal, deadline);
          return fetchText(latinDictionary.indexUrl, 'text/plain', requestLimits.indexBytes, requestSignal);
        }, requestSignal);
        await guard(identity, requestSignal, deadline);
        return resolveLatinCandidate(rows, candidate);
      }, { signal, deadline });
    },
    retrieve(resolution, entryId, identity, signal, deadline) {
      if (!resolution.alternatives.some(item => item.entryId === entryId)) {
        return Promise.reject(new RequestFailure('format', 'Choose an indexed dictionary alternative before retrieving an article.'));
      }
      return dependencies.executor.run(async requestSignal => {
        await guard(identity, requestSignal, deadline);
        const url = latinArticleUrl(entryId);
        const html = await fetchText(url, 'text/html', requestLimits.articleBytes, requestSignal);
        await guard(identity, requestSignal, deadline);
        return extractLatinArticle(html, entryId, url);
      }, { signal, deadline });
    },
  };
}
