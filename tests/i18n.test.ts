import { test } from 'node:test';
import assert from 'node:assert/strict';
import english from '../public/_locales/en/messages.json' with { type: 'json' };
import chinese from '../public/_locales/zh_CN/messages.json' with { type: 'json' };
import { errorMessage, isUiMessage, message, resolveInterfaceLocale, translate } from '../src/i18n/messages.ts';
import type { InterfaceLanguage } from '../src/i18n/messages.ts';
import { InterfacePreference } from '../src/i18n/preference.ts';
import { ConfigurationStore } from '../src/core/configuration.ts';
import { providerCatalog } from '../src/providers/catalog.ts';

test('browser default selects only supported language/script combinations and explicit choices override it', () => {
  for (const value of ['zh', 'zh-CN', 'zh_CN', 'zh-SG', 'zh-Hans', 'zh-Hans-TW']) assert.equal(resolveInterfaceLocale('auto', value), 'zh-Hans', value);
  for (const value of ['en', 'en-GB', 'en-US', 'cs', 'zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'invalid_locale!', '']) assert.equal(resolveInterfaceLocale('auto', value), 'en', value);
  assert.equal(resolveInterfaceLocale('en', 'zh-CN'), 'en');
  assert.equal(resolveInterfaceLocale('zh-Hans', 'en-US'), 'zh-Hans');
});
test('shipping translations are complete, nonempty and preserve Chrome placeholders', () => {
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const [id, value] of Object.entries(english)) {
    const translated = chinese[id as keyof typeof chinese];
    assert.ok(translated.message.trim(), id);
    const placeholders = (text: string) => [...text.matchAll(/\$([a-zA-Z]+)\$/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(translated.message), placeholders(value.message), id);
    const declared = 'placeholders' in value ? Object.keys(value.placeholders as object).sort() : [];
    assert.deepEqual([...new Set(placeholders(value.message))], declared, id);
  }
  assert.equal(translate('zh-Hans', message('brand')), '天书');
  assert.equal(translate('zh-Hans', message('passageWord', { word: '<script>$word$</script>', index: 1, total: 2 })), '查询 <script>$word$</script>（第 1 个词，共 2 个）');
});
test('message descriptors reject untrusted shapes and unexpected errors receive a localized recovery message', () => {
  assert.ok(isUiMessage(message('replaceExplanation', { language: 'Latin' })));
  for (const value of [null, [], { id: 'not-a-message' }, { id: 'saved', args: [] }, { id: 'saved', args: { count: Infinity } }]) assert.equal(isUiMessage(value), false);
  assert.equal(translate('zh-Hans', errorMessage(new Error('Internal detail'))), '操作失败，请重试。');
});
test('interface saves persist independently of lookup configuration and only successful writes become current', async () => {
  let saved: unknown, fail = false;
  const storage = { read: async () => saved, write: async (value: InterfaceLanguage) => { if (fail) throw new Error('Storage failed'); saved = value; } };
  const preference = new InterfacePreference(storage);
  let lookupSettings: unknown;
  const configuration = new ConfigurationStore(providerCatalog, { read: async () => lookupSettings, write: async value => { lookupSettings = value; } }, () => 'unchanged');
  const before = await configuration.get();
  assert.equal(await preference.get(), 'auto');
  await preference.save('zh-Hans');
  assert.equal(await new InterfacePreference(storage).get(), 'zh-Hans');
  assert.deepEqual(await configuration.get(), before);
  fail = true; await assert.rejects(preference.save('en'), /Storage failed/);
  assert.equal(await preference.get(), 'zh-Hans');
  await assert.rejects(preference.save('zh-Hant'), /supported interface/);
  fail = false;
  await Promise.all([preference.save('en'), preference.save('auto')]);
  assert.equal(await preference.get(), 'auto');
  saved = 'retired-language'; assert.equal(await new InterfacePreference(storage).get(), 'auto');
});
