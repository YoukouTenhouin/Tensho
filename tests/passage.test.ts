import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSelection } from '../src/core/input.ts';
import { LookupCoordinator } from '../src/core/lookup.ts';
import type { Analysis, Identity } from '../src/core/lookup.ts';

const identity: Identity = { tabId: 1, frameId: 2, documentId: 'frame', topDocumentId: 'top', configuration: 'latin-en', lookupLanguage: 'lat', explanationLanguage: 'en' };
const result: Analysis = { provider: 'controlled', controlled: true, candidates: [] };
function words(text: string) {
  const prepared = prepareSelection(text);
  if ('error' in prepared) assert.fail(prepared.error);
  return prepared.words;
}
function fixture() {
  const calls: { text: string; identity: Identity; signal: AbortSignal; deadline: number; resolve(value: Analysis): void; reject(error: Error): void }[] = [];
  const coordinator = new LookupCoordinator({ analyze: (text, source, signal, deadline) =>
    new Promise((resolve, reject) => calls.push({ text, identity: source, signal, deadline, resolve, reject })) }, () => {});
  return { coordinator, calls };
}

test('word offering removes punctuation boundaries and preserves spelling, connectors, enclitics and Unicode source slices', () => {
  const original = ' “Arma,”\nvirumque; mālum ma\u0304lum l’amour d\'arma ab-cd ab‐cd ab‑cd 𐌀𐌁! (ʼarmaʼ) ...';
  const offered = words(original);
  assert.deepEqual(offered.map(word => word.text), ['Arma', 'virumque', 'mālum', 'ma\u0304lum', 'l’amour', "d'arma", 'ab-cd', 'ab‐cd', 'ab‑cd', '𐌀𐌁', 'arma']);
  for (const word of offered) assert.equal(original.slice(word.start, word.end), word.text);
  assert.deepEqual(words('arma,virumque—cano').map(word => word.text), ['arma', 'virumque', 'cano']);
  assert.deepEqual(words('arma arma').map(word => word.text), ['arma', 'arma'], 'repeat occurrences stay available');
});

test('all passage, offered-word and count limits reject the whole selection without truncating', () => {
  const exactWord = '𐌀'.repeat(256);
  assert.equal(words(exactWord)[0]!.text, exactWord);
  assert.ok('error' in prepareSelection('𐌀'.repeat(257)));
  const combiningWord = 'a\u0304'.repeat(128);
  assert.equal(words(combiningWord)[0]!.text, combiningWord);
  assert.ok('error' in prepareSelection(combiningWord + '\u0304'));
  const exactCount = Array(256).fill('a').join(' ');
  assert.equal(words(exactCount).length, 256);
  assert.ok('error' in prepareSelection(exactCount + ' a'));
  // 256 15-code-point words, 255 separators and one trailing space = 4,096.
  const exactPassage = Array(256).fill('𐌀'.repeat(15)).join(' ') + ' ';
  assert.equal([...exactPassage].length, 4096);
  assert.equal(words(exactPassage).length, 256);
  assert.ok('error' in prepareSelection(exactPassage + ' '));
  assert.ok('error' in prepareSelection('arma ' + 'a'.repeat(257)));
  for (const input of ['', '  ', '...—?!', '\u0304']) assert.ok('error' in prepareSelection(input));
});

test('production selection offers a retained passage with zero automatic calls and one explicit word follows the lookup path', async () => {
  const { coordinator, calls } = fixture();
  const original = '  “Arma,”\nvirumque cano.  ';
  await coordinator.lookup(identity, original);
  assert.equal(calls.length, 0);
  const state = coordinator.get(1)!;
  assert.equal(state.text, original); assert.equal(state.passage!.original, original);
  const passageId = state.passage!.id;
  const pending = coordinator.selectWord(1, passageId, 1);
  assert.equal(calls.length, 1); assert.equal(calls[0]!.text, 'virumque');
  assert.equal(coordinator.get(1)?.text, 'virumque');
  assert.equal(coordinator.get(1)?.status, 'loading');
  assert.equal(coordinator.get(1)?.passage?.original, original);
  assert.equal(coordinator.get(1)?.passage?.selectedIndex, 1);
  assert.deepEqual(calls[0]!.identity, identity);
  calls[0]!.resolve(result); await pending;
  assert.equal(coordinator.get(1)?.status, 'complete');
  assert.equal(coordinator.get(1)?.passage?.id, passageId);
  assert.equal(coordinator.get(1)?.passage?.words.length, 3);
});

test('rapid choices share passage identity but newer word generations reject reordered results and retain controls on failure', async () => {
  const { coordinator, calls } = fixture();
  await coordinator.lookup(identity, 'arma virumque cano');
  const id = coordinator.get(1)!.passage!.id;
  const first = coordinator.selectWord(1, id, 0);
  const second = coordinator.selectWord(1, id, 2);
  assert.equal(coordinator.get(1)?.text, 'cano');
  assert.ok(calls[0]!.signal.aborted);
  calls[1]!.reject(new Error('Controlled provider failure')); await second;
  calls[0]!.resolve(result); await first;
  const state = coordinator.get(1)!;
  assert.equal(state.status, 'error'); assert.equal(state.text, 'cano'); assert.equal(state.passage?.id, id);
  assert.equal(state.passage?.words.length, 3);
  const retry = coordinator.selectWord(1, id, 2);
  assert.equal(calls.length, 3); calls[2]!.resolve(result); await retry;
  assert.equal(coordinator.get(1)?.status, 'complete'); assert.equal(coordinator.get(1)?.passage?.id, id);
});

test('invalid, old and out-of-range word choices cannot issue a lookup; a new selection replaces the passage', async () => {
  const { coordinator, calls } = fixture();
  await coordinator.lookup(identity, 'arma virumque'); const id = coordinator.get(1)!.passage!.id;
  for (const index of [-1, 2, 0.5, Number.NaN]) await coordinator.selectWord(1, id, index);
  await coordinator.selectWord(1, id + 1, 0);
  assert.equal(calls.length, 0);
  const newWord = coordinator.lookup(identity, 'cano'); calls[0]!.resolve(result); await newWord;
  assert.equal(coordinator.get(1)?.passage, undefined);
  await coordinator.selectWord(1, id, 0); assert.equal(calls.length, 1);
});

test('source/configuration changes and reordered browser captures cannot reuse stale passage controls', async () => {
  const { coordinator, calls } = fixture();
  await coordinator.lookup(identity, 'arma virumque'); const id = coordinator.get(1)!.passage!.id;
  const earlier = coordinator.begin(1, 2);
  const later = coordinator.begin(1, 2);
  const second = later.selectWord(identity, id, 1);
  await earlier.selectWord(identity, id, 0);
  assert.deepEqual(calls.map(call => call.text), ['virumque']);
  calls[0]!.resolve(result); await second;
  const changed = coordinator.begin(1, 2);
  await changed.selectWord({ ...identity, configuration: 'changed' }, id, 0);
  assert.equal(calls.length, 1);
  coordinator.navigate(1, 2); await coordinator.selectWord(1, id, 0);
  assert.equal(coordinator.get(1), undefined); assert.equal(calls.length, 1);
});

test('single punctuated words retain their original selection while only the offered spelling reaches analysis', async () => {
  const { coordinator, calls } = fixture();
  const pending = coordinator.lookup(identity, ' “mālum!” ');
  assert.equal(calls[0]!.text, 'mālum'); assert.equal(coordinator.get(1)?.text, ' “mālum!” ');
  calls[0]!.resolve(result); await pending;
});

test('production coordination enforces every passage bound before any word is requested', async () => {
  const { coordinator, calls } = fixture();
  for (const input of [Array(257).fill('a').join(' '), 'arma ' + '𐌀'.repeat(257), 'a'.repeat(4097)]) {
    await coordinator.lookup(identity, input);
    const state = coordinator.get(1)!;
    assert.equal(state.status, 'notice'); assert.equal(state.text, input);
    assert.equal(state.passage, undefined); assert.equal(calls.length, 0);
  }
  const original = Array(256).fill('𐌀'.repeat(15)).join(' ') + ' ';
  await coordinator.lookup(identity, original);
  const passage = coordinator.get(1)!.passage!;
  assert.equal(passage.words.length, 256); assert.equal(passage.original, original); assert.equal(calls.length, 0);
  const lookup = coordinator.selectWord(1, passage.id, 255);
  assert.equal([...calls[0]!.text].length, 15); calls[0]!.resolve(result); await lookup;
});
