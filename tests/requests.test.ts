import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestExecutor, RequestFailure, readBoundedJson, requestLimits } from '../src/core/requests.ts';
import { providerAccessRemoved } from '../src/core/provider-access.ts';
const options = () => ({ signal: new AbortController().signal, deadline: performance.now() + 1_000 });
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function failure(kind: string) { return (error: unknown) => error instanceof RequestFailure && error.kind === kind; }

test('two provider slots bound actual operations, including a cancelled request ignoring abort', async () => {
  const executor = new RequestExecutor();
  const first = deferred<number>(), second = deferred<number>(), third = deferred<number>();
  const controller = new AbortController();
  const starts: number[] = [];
  const a = executor.run(() => { starts.push(1); return first.promise; }, { ...options(), signal: controller.signal });
  const b = executor.run(() => { starts.push(2); return second.promise; }, options());
  const c = executor.run(() => { starts.push(3); return third.promise; }, options());
  await turn(); assert.deepEqual(starts, [1, 2]);
  controller.abort(); await assert.rejects(a, failure('cancelled'));
  await turn(); assert.deepEqual(starts, [1, 2]);
  first.resolve(1); await turn(); assert.deepEqual(starts, [1, 2, 3]);
  second.resolve(2); third.resolve(3); assert.deepEqual(await Promise.all([b, c]), [2, 3]);
});

test('queued action deadline expires without starting a provider request', async () => {
  const executor = new RequestExecutor({ concurrent: 1, requestMs: 1_000 });
  const held = deferred<number>();
  const active = executor.run(() => held.promise, options());
  let called = false;
  await assert.rejects(executor.run(async () => { called = true; }, { ...options(), deadline: performance.now() + 20 }), failure('action-deadline'));
  assert.equal(called, false); held.resolve(1); await active;
});

test('request timeout aborts and rejects late completion without releasing a still-running operation', async () => {
  const executor = new RequestExecutor({ concurrent: 1, requestMs: 20 });
  const held = deferred<number>();
  let requestSignal: AbortSignal | undefined;
  const first = executor.run(signal => { requestSignal = signal; return held.promise; }, options());
  await assert.rejects(first, failure('request-timeout')); assert.equal(requestSignal?.aborted, true);
  let nextStarted = false;
  const next = executor.run(async () => { nextStarted = true; return 2; }, options());
  await turn(); assert.equal(nextStarted, false);
  held.resolve(1); assert.equal(await next, 2);
});

test('already expired and cancelled actions never execute', async () => {
  const executor = new RequestExecutor();
  const execute = async () => { assert.fail('must not execute'); };
  await assert.rejects(executor.run(execute, { ...options(), deadline: 0 }), failure('action-deadline'));
  await assert.rejects(executor.run(execute, { ...options(), signal: AbortSignal.abort() }), failure('cancelled'));
});

test('decoded response bound accepts exact size and rejects one byte over before parsing', async () => {
  const exact = '"' + 'a'.repeat(requestLimits.analysisBytes - 2) + '"';
  assert.equal((await readBoundedJson(new Response(exact), options().signal) as string).length, requestLimits.analysisBytes - 2);
  await assert.rejects(readBoundedJson(new Response(exact + ' '), options().signal), failure('size'));
});

test('HTTP, malformed JSON and malformed UTF-8 are distinct from valid empty provider data', async () => {
  assert.deepEqual(await readBoundedJson(new Response('{}'), options().signal), {});
  await assert.rejects(readBoundedJson(new Response('{}', { status: 403 }), options().signal), failure('http'));
  await assert.rejects(readBoundedJson(new Response('{'), options().signal), failure('format'));
  await assert.rejects(readBoundedJson(new Response(new Uint8Array([0xff])), options().signal), failure('format'));
});

test('cancelling a queued action removes it without occupying a provider slot', async () => {
  const executor = new RequestExecutor({ concurrent: 1, requestMs: 1_000 });
  const held = deferred<number>();
  const first = executor.run(() => held.promise, options());
  const controller = new AbortController();
  const cancelled = executor.run(async () => { assert.fail('cancelled queue entry executed'); }, { ...options(), signal: controller.signal });
  controller.abort(); await assert.rejects(cancelled, failure('cancelled'));
  const next = executor.run(async () => 3, options());
  held.resolve(1); assert.deepEqual(await Promise.all([first, next]), [1, 3]);
});

test('aborting a stalled response cancels its reader and prevents parsing', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const result = readBoundedJson(new Response(stream), controller.signal);
  controller.abort(); await assert.rejects(result, { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('revocation cancels affected active and queued operations without releasing an abort-ignoring slot', async () => {
  const executor = new RequestExecutor({ concurrent: 1, requestMs: 1_000 });
  const held = deferred<number>(); let signal: AbortSignal | undefined;
  const origins = ['https://morph.alpheios.net/*'];
  const first = executor.run(active => { signal = active; return held.promise; }, { ...options(), origins });
  const queued = executor.run(async () => { assert.fail('revoked queued request started'); }, { ...options(), origins });
  const firstRejected = assert.rejects(first, failure('revoked-access'));
  const queuedRejected = assert.rejects(queued, failure('revoked-access'));
  let unrelatedStarted = false;
  const unrelated = executor.run(async () => { unrelatedStarted = true; return 3; }, { ...options(), origins: ['https://repos1.alpheios.net/*'] });
  await turn(); executor.revokeAccess(origins);
  await Promise.all([firstRejected, queuedRejected]); assert.equal(signal?.aborted, true);
  assert.equal(unrelatedStarted, false, 'ignored abort still owns its actual operation slot');
  held.resolve(1); assert.equal(await unrelated, 3);
});

test('revocation between queue dispatch and execution prevents the provider callback', async () => {
  const executor = new RequestExecutor();
  const origins = ['https://morph.alpheios.net/*'];
  const request = executor.run(async () => { assert.fail('revoked request reached provider'); }, { ...options(), origins });
  const rejected = assert.rejects(request, failure('revoked-access'));
  executor.revokeAccess(['https://*.alpheios.net/*']); await rejected;
  assert.equal(await executor.run(async () => 2, { ...options(), origins }), 2, 'new actions still undergo adapter permission guards');
});

test('provider revocation scopes respect scheme and hostname boundaries including wildcard removals', () => {
  const origins = ['https://morph.alpheios.net/*'];
  for (const removed of ['https://morph.alpheios.net/*', 'https://*.alpheios.net/*', '*://*.alpheios.net/*', 'https://*/*', '<all_urls>']) {
    assert.equal(providerAccessRemoved(origins, [removed]), true, removed);
  }
  for (const removed of ['http://morph.alpheios.net/*', 'https://repos1.alpheios.net/*', 'https://alpheios.net/*', 'https://*.notalpheios.net/*', 'https://morph.alpheios.net:8443/*']) {
    assert.equal(providerAccessRemoved(origins, [removed]), false, removed);
  }
  assert.equal(providerAccessRemoved([], ['<all_urls>']), false);
  assert.equal(providerAccessRemoved(['https://provider.invalid:8443/*'], ['https://provider.invalid:443/*']), false);
  assert.equal(providerAccessRemoved(['https://provider.invalid:8443/*'], ['https://provider.invalid/*']), true);
});
