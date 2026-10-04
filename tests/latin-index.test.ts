import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LatinIndexCache, indexCacheKey, indexCacheLifetimeMs, parseLatinIndex, resolveLatinCandidate } from '../src/providers/latin-index.ts';
import type { IndexStorage } from '../src/providers/latin-index.ts';
import { normalizeWhitaker } from '../src/providers/whitaker.ts';
import { RequestFailure, readBoundedText, requestLimits } from '../src/core/requests.ts';

const evidence = JSON.parse(readFileSync(new URL('./fixtures/lewis-short/index-rows.json', import.meta.url), 'utf8'));
const rows = parseLatinIndex(evidence.rows.join('\n'));
const candidate = (lemma: string | null) => ({ lemma, interpretations: [], meanings: [], stableId: null });
const failure = (kind: string) => (error: unknown) => error instanceof RequestFailure && error.kind === kind;
const signal = () => new AbortController().signal;

test('retained Latin candidates resolve independently, preserving misleading homographs and singleton uncertainty', () => {
  const expected: Record<string, string[]> = {
    importo: ['n21985'], puella: ['n39421'], lego: ['n26185', 'n26186'], lex: ['n26431'],
    amo: ['n2280'], mala: ['n27674'], malus: ['n27776', 'n27777', 'n27778'], malum: ['n27773', 'n27774'],
  };
  for (const [root, ids] of Object.entries(expected)) {
    const result = resolveLatinCandidate(rows, candidate(root));
    assert.deepEqual(result.alternatives.map(item => item.entryId), ids);
    assert.equal(result.automaticSelection, null);
    assert.equal(result.exhaustive, false);
    assert.ok(result.alternatives.every(item => item.correspondence === 'unverified'));
  }
  for (const word of ['important', 'legi', 'malum', 'mālum']) {
    const raw = JSON.parse(readFileSync(new URL(`./fixtures/whitaker/${word}.json`, import.meta.url), 'utf8'));
    const analysis = normalizeWhitaker(raw);
    const results = analysis.candidates.map(item => resolveLatinCandidate(rows, { ...item, interpretations: [] }));
    assert.equal(results.length, analysis.candidates.length);
    results.forEach((result, i) => {
      const original = analysis.candidates[i]!;
      assert.equal(result.originalHeadword, original.lemma);
      assert.deepEqual(result.provenance, original.provenance);
      assert.equal(result.stableLemmaId, null);
      assert.deepEqual(result.alternatives.map(item => item.entryId), expected[result.root]);
    });
    if (word === 'malum' || word === 'mālum') {
      assert.equal(results[1]!.originalHeadword, results[2]!.originalHeadword);
      assert.notDeepEqual(results[1]!.provenance, results[2]!.provenance);
      assert.notEqual(results[1]!.alternatives, results[2]!.alternatives);
    }
  }
});

test('resolver retains encounter order and duplicate-row provenance without inventing missing numbered siblings', () => {
  const input = parseLatinIndex('@lego7|n7\nlego|@\n@lego|n1\n@lego1|n1\n@lego20|n20\n@lego0|n0\n@lego01|n01\n@lego2x|n2\n@legos2|n99');
  const result = resolveLatinCandidate(input, candidate('lego, legere, legi'));
  assert.deepEqual(result.alternatives.map(item => item.entryId), ['n7', 'n1', 'n20']);
  assert.deepEqual(result.alternatives[1]!.rows, [
    { key: '@lego', entryId: 'n1', line: 3 }, { key: '@lego1', entryId: 'n1', line: 4 },
  ]);
  for (const lemma of ['zzqxx', 'Lego', 'lēgo', null]) {
    assert.equal(resolveLatinCandidate(input, candidate(lemma)).status, 'unresolved-mapping');
  }
});

test('index parser validates targets and complete rows while retaining genuine multiword keys', () => {
  assert.deepEqual(parseLatinIndex('aeneae portus|n1233\r\nlego|@\r\n'), [
    { key: 'aeneae portus', entryId: 'n1233', line: 1 }, { key: 'lego', entryId: '@', line: 2 },
  ]);
  for (const invalid of ['', '<html>failure</html>', 'lego|https://example.com', 'lego|n1|extra', '|n1', 'lego|n1\n\n', 'le\tgo|n1']) {
    assert.throws(() => parseLatinIndex(invalid), failure('format'));
  }
});

test('persistent index cache uses only matching fresh validated data; expired refresh failure never serves stale rows', async () => {
  let now = 1_000_000_000;
  let saved: unknown;
  let writes = 0, fetches = 0;
  const storage: IndexStorage = { read: async () => saved, write: async value => { saved = value; writes++; } };
  const cache = new LatinIndexCache(storage, () => now);
  const refresh = async () => { fetches++; return 'lego|n1'; };
  assert.equal((await cache.get(refresh, signal()))[0]!.entryId, 'n1');
  assert.deepEqual(saved, { key: indexCacheKey, storedAt: now, text: 'lego|n1' });
  now += indexCacheLifetimeMs - 1;
  await cache.get(refresh, signal()); assert.equal(fetches, 1); assert.equal(writes, 1);
  now++;
  await assert.rejects(cache.get(async () => { throw new RequestFailure('network', 'Refresh failed'); }, signal()), failure('network'));
  assert.equal(writes, 1);
  await cache.get(refresh, signal()); assert.equal(fetches, 2);
  for (const invalid of [
    { key: 'old-format', storedAt: now, text: 'lego|n9' },
    { key: indexCacheKey, storedAt: now + 1, text: 'lego|n9' },
    { key: indexCacheKey, storedAt: now, text: '<html>Error</html>' },
  ]) {
    saved = invalid;
    assert.equal((await cache.get(refresh, signal()))[0]!.entryId, 'n1');
  }
  assert.equal(fetches, 5);
});

test('malformed refresh and cancelled refresh do not replace persisted cache', async () => {
  let writes = 0;
  const cache = new LatinIndexCache({ read: async () => undefined, write: async () => { writes++; } });
  await assert.rejects(cache.get(async () => '<p>Error</p>', signal()), failure('format'));
  const controller = new AbortController();
  await assert.rejects(cache.get(async () => { controller.abort(); return 'lego|n1'; }, controller.signal), { name: 'AbortError' });
  assert.equal(writes, 0);
});

test('decoded dictionary text accepts exact article/index limits and rejects one byte over', async () => {
  for (const limit of [requestLimits.articleBytes, requestLimits.indexBytes]) {
    const text = 'ā'.repeat(limit / 2);
    assert.equal(await readBoundedText(new Response(text), signal(), limit), text);
    await assert.rejects(readBoundedText(new Response(text + 'x'), signal(), limit), failure('size'));
  }
  assert.throws(() => parseLatinIndex('a'.repeat(requestLimits.indexBytes + 1)), failure('size'));
});
