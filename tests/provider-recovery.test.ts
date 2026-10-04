import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../src/core/configuration.ts';
import type { ProviderCatalog, ProviderDeclaration } from '../src/core/configuration.ts';
import { ProviderRouter } from '../src/core/provider-router.ts';
import { LookupCoordinator } from '../src/core/lookup.ts';
import type { Analysis, Analyzer, Identity } from '../src/core/lookup.ts';
import { RequestExecutor, RequestFailure } from '../src/core/requests.ts';
import type { RequestFailureKind } from '../src/core/requests.ts';

const provider = (id: string, language = 'lat', explanations = ['en']): ProviderDeclaration => ({
  id, name: id, capabilities: [{ lookupLanguage: language, role: 'analysis', explanationLanguages: explanations, inputNotations: ['Controlled Unicode'], structuralAnalysis: true }],
  origins: [`https://${id}.invalid/*`], attribution: ['Controlled evidence'], options: {}, defaultEnabled: true,
});
const catalog: ProviderCatalog = { languages: [{ id: 'lat', name: 'Latin', defaultExplanation: 'en' }], providers: [provider('first'), provider('second')] };
const result: Analysis = { provider: 'second', controlled: true, outcome: 'usable', candidates: [{ lemma: 'importo', stableId: null, interpretations: [], meanings: ['bring in'] }] };
function setup(analyzers: Record<string, Analyzer>, declarations = catalog, permitted: (origins: readonly string[]) => Promise<boolean> = async () => true) {
  const settings = defaultSettings(declarations, 'configured');
  const identity: Identity = { tabId: 1, frameId: 0, documentId: 'doc', topDocumentId: 'doc', configuration: settings.revision, lookupLanguage: 'lat', explanationLanguage: 'en' };
  const router = new ProviderRouter({ catalog: declarations, settings: async () => structuredClone(settings), permitted, analyzers, dictionaries: {} });
  const lookup = new LookupCoordinator(router, () => {});
  return { settings, identity, router, lookup };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('every technical failure advances exactly once and retains the successful provider plus earlier reason', async () => {
  for (const kind of ['network', 'http', 'format', 'size', 'identity-mismatch', 'request-timeout'] satisfies RequestFailureKind[]) {
    const calls: string[] = [];
    const app = setup({ first: { analyze: async () => { calls.push('first'); throw new RequestFailure(kind, `Controlled ${kind}`); } },
      second: { analyze: async () => { calls.push('second'); return result; } } });
    await app.lookup.lookup(app.identity, 'important');
    const state = app.lookup.get(1)!;
    assert.equal(state.status, 'complete'); if (state.status !== 'complete') assert.fail();
    assert.deepEqual(calls, ['first', 'second']); assert.equal(state.analysis.provider, 'second');
    assert.deepEqual(state.analysis.providerIssues, [{ providerId: 'first', providerName: 'first', operation: 'analysis', kind, message: `Controlled ${kind}`, attempted: true }]);
  }
});

test('no-match and usable partial analysis end the chain without filling gaps', async () => {
  for (const value of [{ ...result, provider: 'first', outcome: 'no-match' as const, candidates: [] },
    { ...result, provider: 'first', candidates: [{ lemma: null, stableId: null, meanings: [], interpretations: ['Verb'] }] }]) {
    let later = 0;
    const app = setup({ first: { analyze: async () => value }, second: { analyze: async () => { later++; return result; } } });
    await app.lookup.lookup(app.identity, 'important');
    assert.equal(later, 0); const state = app.lookup.get(1)!;
    assert.equal(state.status, 'complete'); if (state.status === 'complete') assert.deepEqual(state.analysis, value);
  }
});

test('language, explanations, enablement, input support and existing access exclude providers before dispatch', async () => {
  const declarations = { ...catalog, providers: [provider('disabled'), provider('denied'), provider('unsupported'), provider('french', 'lat', ['fr']), provider('english', 'eng'), provider('second')] };
  const calls: string[] = [], permissionChecks: string[] = [];
  const analyzers = Object.fromEntries(declarations.providers.map(item => [item.id, {
    supportsInput: () => item.id !== 'unsupported', analyze: async () => { calls.push(item.id); return result; },
  }]));
  const app = setup(analyzers, declarations, async origins => { permissionChecks.push(origins[0]!); return !origins[0]!.includes('denied'); });
  app.settings.languages.lat!.analysis[0]!.enabled = false;
  await app.lookup.lookup(app.identity, 'important');
  assert.deepEqual(calls, ['second']);
  assert.deepEqual(permissionChecks, ['https://denied.invalid/*', 'https://second.invalid/*', 'https://second.invalid/*']);
  const state = app.lookup.get(1)!; assert.equal(state.status, 'complete');
  if (state.status === 'complete') assert.deepEqual(state.analysis.providerIssues?.map(issue => [issue.providerId, issue.kind, issue.attempted]),
    [['denied', 'missing-access', false], ['unsupported', 'unsupported-input', false]]);
});

test('exhaustion preserves all failures and explicit retry starts one fresh attempt per provider', async () => {
  const calls: string[] = [];
  const analyzers = Object.fromEntries(['first', 'second'].map(id => [id, { analyze: async () => { calls.push(id); throw new RequestFailure('http', `${id} unavailable`); } }]));
  const app = setup(analyzers);
  for (let retry = 0; retry < 2; retry++) {
    await app.lookup.lookup(app.identity, 'important');
    const state = app.lookup.get(1)!; assert.equal(state.status, 'error');
    if (state.status === 'error') assert.deepEqual(state.providerIssues?.map(issue => issue.providerId), ['first', 'second']);
  }
  assert.deepEqual(calls, ['first', 'second', 'first', 'second']);
});

test('missing access stays explicit with zero provider calls, and action deadline never advances the chain', async () => {
  let calls = 0;
  const missing = setup({ first: { analyze: async () => { calls++; return result; } }, second: { analyze: async () => { calls++; return result; } } }, catalog, async () => false);
  await missing.lookup.lookup(missing.identity, 'important');
  const missingState = missing.lookup.get(1)!;
  assert.equal(missingState.status, 'error'); if (missingState.status === 'error') assert.equal(missingState.failureKind, 'missing-access');
  assert.equal(calls, 0);
  const timed = setup({ first: { analyze: async () => { calls++; throw new RequestFailure('action-deadline', 'Action expired'); } }, second: { analyze: async () => { calls++; return result; } } });
  await timed.lookup.lookup(timed.identity, 'important');
  assert.equal(calls, 1); const state = timed.lookup.get(1)!;
  assert.equal(state.status, 'error'); if (state.status === 'error') assert.equal(state.failureKind, 'action-deadline');
});

test('revocation before retaining a returned result is visible and never advances to another provider', async () => {
  let allowed = true; const calls: string[] = [];
  const app = setup({ first: { analyze: async () => { calls.push('first'); allowed = false; return result; } },
    second: { analyze: async () => { calls.push('second'); return result; } } }, catalog, async () => allowed);
  await app.lookup.lookup(app.identity, 'important');
  const state = app.lookup.get(1)!; assert.equal(state.status, 'error');
  if (state.status === 'error') {
    assert.equal(state.failureKind, 'revoked-access');
    assert.equal(state.providerIssues?.[0]?.kind, 'revoked-access');
  }
  assert.deepEqual(calls, ['first']);
});

test('revocation rejects an abort-ignoring operation even if access is granted again before its late response', async () => {
  const executor = new RequestExecutor(); let finish!: (value: Analysis) => void; let later = 0;
  const app = setup({ first: { analyze: async (_text, _identity, signal, deadline) => executor.run(
    () => new Promise<Analysis>(resolve => { finish = resolve; }), { signal, deadline, origins: ['https://first.invalid/*'] }) },
    second: { analyze: async () => { later++; return result; } } });
  const lookup = app.lookup.lookup(app.identity, 'important'); await turn();
  executor.revokeAccess(['https://first.invalid/*']); await lookup;
  const state = app.lookup.get(1)!; assert.equal(state.status, 'error');
  if (state.status === 'error') assert.equal(state.failureKind, 'revoked-access');
  finish(result); await turn(); assert.equal(app.lookup.get(1), state); assert.equal(later, 0);
});

test('the action deadline bounds a stalled later provider and does not claim untouched providers failed', async () => {
  const declarations = { ...catalog, providers: [...catalog.providers, provider('third')] };
  let signal: AbortSignal | undefined; const calls: string[] = [];
  const app = setup({ first: { analyze: async () => { calls.push('first'); throw new RequestFailure('network', 'Offline'); } },
    second: { analyze: async (_text, _identity, active) => { calls.push('second'); signal = active; return new Promise(() => {}); } },
    third: { analyze: async () => { calls.push('third'); return result; } } }, declarations);
  await assert.rejects(app.router.analyze('important', app.identity, new AbortController().signal, performance.now() + 30), error => {
    assert.ok(error instanceof RequestFailure); assert.equal(error.kind, 'action-deadline');
    assert.deepEqual(error.issues.map(issue => issue.providerId), ['first']); return true;
  });
  assert.deepEqual(calls, ['first', 'second']); assert.equal(signal?.aborted, true);
});

test('fallback across concurrent lookups preserves the shared two-request bound without retrying timed-out providers', async () => {
  const executor = new RequestExecutor({ concurrent: 2, requestMs: 15 });
  let active = 0, maximum = 0; const calls: string[] = []; const lingering: Promise<void>[] = [];
  const app = setup(Object.fromEntries(['first', 'second'].map(id => [id, { analyze: async (_text: string, identity: Identity, signal: AbortSignal, deadline: number) =>
    executor.run(async () => {
      calls.push(`${identity.tabId}:${id}`); active++; maximum = Math.max(maximum, active);
      try {
        if (id === 'first') { const pending = new Promise<void>(resolve => setTimeout(resolve, 40)); lingering.push(pending); await pending; }
        return result;
      }
      finally { active--; }
    }, { signal, deadline }) }])));
  await Promise.all([1, 2, 3].map(tabId => app.router.analyze('important', { ...app.identity, tabId }, new AbortController().signal, performance.now() + 300)));
  await Promise.all(lingering); await turn();
  assert.equal(maximum, 2); assert.equal(active, 0); assert.equal(new Set(calls).size, 6); assert.equal(calls.length, 6);
  await turn();
});

test('revocation discovered inside an adapter remains explicit without being reported as a technical failure', async () => {
  const calls: string[] = [];
  const app = setup({ first: { analyze: async () => { calls.push('first'); throw new RequestFailure('missing-access', 'Access was revoked before dispatch.'); } },
    second: { analyze: async () => { calls.push('second'); return result; } } });
  await app.lookup.lookup(app.identity, 'important');
  assert.deepEqual(calls, ['first', 'second']);
  const state = app.lookup.get(1)!; assert.equal(state.status, 'complete');
  if (state.status === 'complete') assert.deepEqual(state.analysis.providerIssues?.map(issue => [issue.kind, issue.attempted]), [['missing-access', true]]);
});
