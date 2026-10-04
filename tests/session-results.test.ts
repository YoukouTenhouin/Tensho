import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionResults, SessionQuotaError, serializedSessionBytes, readingSessionBytes } from '../src/core/session-results.ts';

const valid = (value: unknown): value is string => typeof value === 'string';
function storage() {
  let saved: unknown; let failure: Error | undefined; let quota = Infinity;
  return { read: async () => structuredClone(saved), write: async (value: unknown) => {
    if (failure) throw failure;
    if (serializedSessionBytes(value) > quota) throw new SessionQuotaError('Controlled quota');
    saved = structuredClone(value);
  }, saved: () => structuredClone(saved), fail: (error?: Error) => { failure = error; }, quota: (bytes: number) => { quota = bytes; } };
}

test('one current result per tab survives worker reconstruction without a selection history', async () => {
  const adapter = storage(); const store = new SessionResults(adapter, valid);
  await store.save(1, 'old selection', [1]); await store.save(2, 'another tab', [1]); await store.save(1, 'current selection', [1]);
  const restored = new SessionResults(adapter, valid);
  assert.deepEqual(await restored.get(1), { status: 'retained', viewed: 0, value: 'current selection' });
  assert.deepEqual(await restored.get(2), { status: 'retained', viewed: 0, value: 'another tab' });
  assert.equal(JSON.stringify(adapter.saved()).includes('old selection'), false);
  await restored.remove(1); assert.equal(await restored.get(1), undefined);
  const restarted = new SessionResults(storage(), valid); assert.deepEqual(await restarted.entries(), [], 'new browser session has no prior reading data');
});

test('the six MiB limit counts exact serialized UTF-8 bytes and accepts the boundary only', async () => {
  const adapter = storage(); const store = new SessionResults(adapter, valid);
  const overhead = serializedSessionBytes({ schema: 1, clock: 0, tabs: { 1: { status: 'retained', viewed: 0, value: '' } } });
  const value = 'x'.repeat(readingSessionBytes - overhead);
  assert.deepEqual(await store.save(1, value, [1]), { retained: true, evicted: [] });
  assert.equal(serializedSessionBytes(adapter.saved()), readingSessionBytes);
  assert.deepEqual(await store.save(1, value + 'x', [1]), { retained: false, reason: 'size' });
  assert.equal((await store.get(1))?.status, 'retained');
  const unicode = '𐐀"\n';
  assert.equal(serializedSessionBytes(unicode), Buffer.byteLength(JSON.stringify({ readingResults: unicode }), 'utf8'));
});

test('eviction follows least recently viewed inactive results and retains a revisit notice', async () => {
  const adapter = storage(); const store = new SessionResults(adapter, valid, 500);
  await store.save(1, 'a'.repeat(100), [1]); await store.view(1);
  await store.save(2, 'b'.repeat(100), [2]); await store.view(2); await store.view(1);
  const result = await store.save(3, 'c'.repeat(150), [3]);
  assert.deepEqual(result, { retained: true, evicted: [2] });
  assert.equal((await store.get(1))?.status, 'retained');
  assert.deepEqual(await store.get(2), { status: 'cleared', viewed: 2 });
  const restored = new SessionResults(adapter, valid, 500); assert.equal((await restored.get(2))?.status, 'cleared');
});

test('an unretainable addition rolls back evictions and preserves all existing results', async () => {
  const adapter = storage(); const store = new SessionResults(adapter, valid, 500);
  await store.save(1, 'existing article', [1]); await store.save(2, 'inactive article', [1]);
  const before = adapter.saved();
  assert.deepEqual(await store.save(1, 'x'.repeat(600), [1]), { retained: false, reason: 'size' });
  assert.deepEqual(adapter.saved(), before); assert.equal((await store.get(2))?.status, 'retained');
});

test('quota pressure evicts inactive results atomically while other storage errors preserve state', async () => {
  const adapter = storage(); const store = new SessionResults(adapter, valid, 1000);
  await store.save(1, 'a'.repeat(150), [1]); await store.save(2, 'b'.repeat(150), [2]);
  adapter.quota(380);
  assert.deepEqual(await store.save(2, 'b'.repeat(160), [2]), { retained: true, evicted: [1] });
  const before = adapter.saved(); adapter.fail(new Error('Storage unavailable'));
  assert.deepEqual(await store.save(2, 'replacement', [2]), { retained: false, reason: 'storage' });
  assert.deepEqual(adapter.saved(), before);
  adapter.fail(new SessionQuotaError('Quota exhausted'));
  assert.deepEqual(await store.save(2, 'replacement', [2]), { retained: false, reason: 'quota' });
  assert.deepEqual(adapter.saved(), before);
});

test('malformed session values are rejected and overlapping saves preserve both tabs', async () => {
  const malformed = new SessionResults({ read: async () => ({ schema: 1, clock: 0, tabs: { 1: { status: 'retained', viewed: 0, value: 42 } } }), write: async () => {} }, valid);
  assert.deepEqual(await malformed.entries(), []);
  const store = new SessionResults(storage(), valid);
  await Promise.all([store.save(1, 'one', [1, 2]), store.save(2, 'two', [1, 2])]);
  assert.equal((await store.entries()).length, 2);
});

test('active tabs are protected even when they are older than inactive results', async () => {
  const adapter = storage(); const store = new SessionResults(adapter, valid, 500);
  await store.save(1, 'a'.repeat(100), [1]); await store.view(1);
  await store.save(2, 'b'.repeat(100), [2]); await store.view(2);
  assert.deepEqual(await store.save(3, 'c'.repeat(150), [1, 3]), { retained: true, evicted: [2] });
  const before = adapter.saved();
  assert.deepEqual(await store.save(4, 'd'.repeat(200), [1, 3, 4]), { retained: false, reason: 'size' });
  assert.deepEqual(adapter.saved(), before);
});
