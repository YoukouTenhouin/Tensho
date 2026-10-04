import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingSessionStorage } from '../src/browser/session-storage.ts';
import { SessionResults, readingSessionKey } from '../src/core/session-results.ts';

const valid = (value: unknown): value is string => typeof value === 'string';
function browserSession() {
  const values: Record<string, unknown> = {};
  const events: string[] = [];
  let quota = Infinity, accessFailure: Error | undefined, writeFailure: Error | undefined;
  const area = {
    setAccessLevel: async ({ accessLevel }: { accessLevel: string }) => {
      events.push(accessLevel); if (accessFailure) throw accessFailure;
    },
    get: async (key: string) => { events.push(`get:${key}`); return structuredClone({ [key]: values[key] }); },
    set: async (value: Record<string, unknown>) => {
      events.push('set');
      if (writeFailure) throw writeFailure;
      if (Buffer.byteLength(JSON.stringify(value)) > quota) throw new Error('QUOTA_BYTES quota exceeded');
      Object.assign(values, structuredClone(value));
    },
  };
  return { area, values, events, quota: (limit: number) => { quota = limit; },
    deny: () => { accessFailure = new Error('Access restriction failed'); }, fail: (error?: Error) => { writeFailure = error; } };
}

test('the browser adapter restricts access before storage operations and writes only session reading data', async () => {
  const browser = browserSession();
  browser.values.unrelatedSessionValue = 'kept';
  const adapter = readingSessionStorage(browser.area);
  const results = new SessionResults(adapter, valid);
  await results.save(1, 'selected text', [1]);
  assert.deepEqual(browser.events, ['TRUSTED_CONTEXTS', `get:${readingSessionKey}`, 'set']);
  assert.equal(browser.values.unrelatedSessionValue, 'kept');
  const restartedWorker = new SessionResults(readingSessionStorage(browser.area), valid);
  assert.deepEqual(await restartedWorker.get(1), { status: 'retained', viewed: 0, value: 'selected text' });
  const restartedBrowser = new SessionResults(readingSessionStorage(browserSession().area), valid);
  assert.deepEqual(await restartedBrowser.entries(), []);
});

test('a failed access restriction prevents both reads and writes', async () => {
  const browser = browserSession(); browser.deny();
  const adapter = readingSessionStorage(browser.area);
  await assert.rejects(adapter.read(), /Access restriction failed/);
  await assert.rejects(adapter.write('private'), /Access restriction failed/);
  assert.deepEqual(browser.events, ['TRUSTED_CONTEXTS']); assert.deepEqual(browser.values, {});
});

test('browser quota errors reach inactive eviction; unavailable storage preserves all prior results', async () => {
  const browser = browserSession();
  const results = new SessionResults(readingSessionStorage(browser.area), valid);
  await results.save(1, 'a'.repeat(150), [1]); await results.save(2, 'b'.repeat(150), [2]);
  browser.quota(380);
  assert.deepEqual(await results.save(2, 'c'.repeat(160), [2]), { retained: true, evicted: [1] });
  assert.equal((await results.get(1))?.status, 'cleared');
  const before = structuredClone(browser.values);
  browser.fail(new Error('Storage service unavailable'));
  assert.deepEqual(await results.save(2, 'replacement', [2]), { retained: false, reason: 'storage' });
  assert.deepEqual(browser.values, before);
  browser.fail(new Error('QUOTA_BYTES quota exceeded'));
  assert.deepEqual(await results.save(2, 'replacement', [2]), { retained: false, reason: 'quota' });
  assert.deepEqual(browser.values, before);
});
