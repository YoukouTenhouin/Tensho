import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LookupCoordinator } from '../src/core/lookup.ts';
import type { Analysis, Identity } from '../src/core/lookup.ts';
import { automaticAllowed, permissionPattern, readingOrigin } from '../src/core/origins.ts';
const identity: Identity = { tabId: 1, frameId: 2, documentId: 'frame-a', topDocumentId: 'doc-a', configuration: 'latin-1', lookupLanguage: 'lat', explanationLanguage: 'en' };
const analysis: Analysis = { provider: 'test', controlled: true, candidates: [] };
function fixture() {
  const calls: { text: string; signal: AbortSignal; finish: (result: Analysis) => void }[] = [];
  const coordinator = new LookupCoordinator({ analyze: (text, _identity, signal) => new Promise(resolve => calls.push({ text, signal, finish: resolve })) }, () => {});
  return { coordinator, calls };
}
test('new selections display immediately and reject older completion even when abort is ignored', async () => {
  const { coordinator, calls } = fixture();
  const first = coordinator.lookup(identity, 'puella');
  const second = coordinator.lookup(identity, 'legi');
  assert.equal(coordinator.get(1)?.text, 'legi');
  assert.equal(coordinator.get(1)?.status, 'loading');
  assert.equal(calls[0]!.signal.aborted, true);
  calls[1]!.finish(analysis); await second;
  calls[0]!.finish({ ...analysis, provider: 'stale' }); await first;
  const state = coordinator.get(1)!;
  assert.equal(state.status, 'complete');
  if (state.status === 'complete') assert.equal(state.analysis.provider, 'test');
});
test('document replacement rejects late completion; tabs remain independent', async () => {
  const { coordinator, calls } = fixture();
  const first = coordinator.lookup(identity, 'puella');
  const second = coordinator.lookup({ ...identity, tabId: 2 }, 'legi');
  coordinator.clear(1);
  calls[0]!.finish(analysis); calls[1]!.finish(analysis);
  await Promise.all([first, second]);
  assert.equal(coordinator.get(1), undefined);
  assert.equal(coordinator.get(2)?.text, 'legi');
});
test('configuration and frame identity are preserved on new work', async () => {
  const { coordinator, calls } = fixture();
  const first = coordinator.lookup(identity, 'a');
  const changed = { ...identity, configuration: 'latin-2', documentId: 'frame-b' };
  const next = coordinator.lookup(changed, 'b');
  calls[0]!.finish(analysis); calls[1]!.finish(analysis); await Promise.all([first, next]);
  assert.deepEqual(coordinator.get(1)?.identity, changed);
});
test('manual and selection bounds prevent calls without truncation', async () => {
  const { coordinator, calls } = fixture();
  for (const input of ['', 'arma virumque', 'ā'.repeat(129), '𐀀'.repeat(2001)]) await coordinator.lookup(identity, input);
  assert.equal(calls.length, 0);
  const valid = coordinator.lookup(identity, 'ā'.repeat(128));
  assert.equal(calls[0]!.text.length, 128); calls[0]!.finish(analysis); await valid;
});
test('origins and native patterns preserve scheme, hostname, and effective port', () => {
  assert.equal(readingOrigin('https://EXAMPLE.com:443/text'), 'https://example.com');
  assert.equal(permissionPattern('https://example.com'), 'https://example.com:443/*');
  assert.equal(permissionPattern('http://example.com:8080'), 'http://example.com:8080/*');
  assert.equal(readingOrigin('file:///tmp/text'), undefined);
  assert.equal(readingOrigin('https://user@example.com'), undefined);
  const enabled = ['https://example.com', 'https://frame.example.com'];
  assert.equal(automaticAllowed(enabled[0]!, enabled[1]!, enabled), true);
  for (const other of ['http://example.com', 'https://example.com:444', 'https://other.example.com']) {
    assert.equal(automaticAllowed(enabled[0]!, other, enabled), false);
    assert.equal(automaticAllowed(other, enabled[1]!, enabled), false);
  }
});
