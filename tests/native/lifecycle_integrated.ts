import { createIntegratedProviders as productionProviders } from '../../src/providers/integrated.ts';
import { latinDictionary } from '../../src/providers/latin-index.ts';

/** Keep the shipping adapters, executor, catalog and permission guards. Only the
 * network transport is controlled; held responses intentionally ignore abort. */
export function createIntegratedProviders(dependencies: Parameters<typeof productionProviders>[0]) {
  const controls = globalThis as typeof globalThis & {
    __tenshoLifecycleHold?: 'analysis' | 'index' | 'article';
    __tenshoLifecycleCalls?: { operation: string; url: string; aborted: boolean }[];
    __tenshoLifecycleRelease?: () => void;
  };
  controls.__tenshoLifecycleCalls = [];
  return productionProviders({ ...dependencies, fetch: async (input, init) => {
    const url = new URL(String(input));
    const operation = url.hostname === 'morph.alpheios.net' ? 'analysis' : url.href === latinDictionary.indexUrl ? 'index' : 'article';
    const call = { operation, url: url.href, aborted: false };
    controls.__tenshoLifecycleCalls!.push(call);
    init?.signal?.addEventListener('abort', () => { call.aborted = true; }, { once: true });
    if (controls.__tenshoLifecycleHold === operation) {
      await new Promise<void>(resolve => { controls.__tenshoLifecycleRelease = resolve; });
    }
    if (operation === 'analysis') return Response.json({ RDF: { Annotation: { Body: { rest: { entry: {
      dict: { hdwd: { lang: 'lat', $: 'malum' } }, infl: { pofs: { $: 'noun' } }, mean: { lang: 'en', $: 'apple' },
    } } } } } });
    if (operation === 'index') return new Response('malum|n1\nmalum|n2\n');
    if (url.origin !== 'https://repos1.alpheios.net' || url.pathname !== '/exist/rest/db/xq/lexi-get.xq') throw new Error('Unexpected fixture URL');
    const id = url.searchParams.get('n');
    if (id !== 'n1' && id !== 'n2') throw new Error('Unexpected fixture entry');
    return new Response(`<div class="alpheios-lex-entry" lemma-id="${id}"><p>Complete controlled article ${id}.</p></div><p class="alpheios-lex-alph-source">Controlled fixture credit.</p>`);
  } });
}
