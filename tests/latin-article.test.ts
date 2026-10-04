import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractLatinArticle, latinArticleUrl } from '../src/providers/latin-article.ts';
import { safeHttpsUrl } from '../src/core/safe-links.ts';
import { RequestFailure, requestLimits } from '../src/core/requests.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/lewis-short/${name}`, import.meta.url), 'utf8');
const wrap = (html: string, id = 'n1') => `<div class="alpheios-lex-entry" lemma-id="${id}">${html}</div>`;
const extract = (html: string) => extractLatinArticle(html, 'n1', latinArticleUrl('n1'));
const formatFailure = (error: unknown) => error instanceof RequestFailure && error.kind === 'format';

test('all twelve retained full articles preserve complete text, paragraphs, credits and foreign quotations', () => {
  const manifest: { entryId: string; sourceUrl: string }[] = JSON.parse(fixture('articles.json'));
  assert.equal(manifest.length, 12);
  for (const { entryId, sourceUrl } of manifest) {
    const result = extractLatinArticle(fixture(`${entryId}.html`), entryId, sourceUrl);
    assert.equal(result.entryId, entryId);
    assert.equal(result.sourceUrl, sourceUrl);
    assert.ok(result.paragraphs.length > 1);
    assert.ok(result.attribution.join(' ').includes('A Latin Dictionary'));
    assert.ok(result.attribution.join(' ').includes('Charlton T. Lewis, Charles Short'));
    // Independently retained research extraction records all source prose in order.
    const expected = JSON.parse(fixture('readable-text.json'))[entryId];
    assert.equal(result.paragraphs.join('\n'), expected);
  }
  const amo = extractLatinArticle(fixture('n2280.html'), 'n2280', latinArticleUrl('n2280')).paragraphs.join('\n');
  assert.ok(amo.includes('ἐράω, φιλέω'));
  assert.ok(amo.includes('amāsse = amavisse'));
});

test('hostile provider markup becomes inert text and separately validated links', () => {
  const result = extractLatinArticle(fixture('hostile.html'), 'n27774', latinArticleUrl('n27774'));
  const text = result.paragraphs.join('\n');
  assert.ok(text.includes('Readable & Latin mālum'));
  assert.ok(text.includes('Attribution: Lewis & Short'));
  assert.ok(text.includes('bad script'));
  assert.ok(text.includes('credentials'));
  assert.ok(!text.includes('window.providerActive'));
  assert.deepEqual(result.links, ['https://repos1.alpheios.net/safe', 'https://alpheios.net/pages/apiterms/']);
  assert.deepEqual(Object.keys(result).sort(), ['attribution', 'dictionary', 'entryId', 'links', 'paragraphs', 'sourceUrl']);
});

test('links reject unsafe schemes, credentials and parser-repaired whitespace while preserving safe relative references', () => {
  const base = latinArticleUrl('n1');
  for (const url of ['javascript:alert(1)', 'data:text/html,boom', 'http://example.org/', 'https://user:pass@example.org/',
    'https://example.org/\nonclick=x', ' https://example.org/', 'https://example.org:99999/', '', 'https://example.org/a b']) {
    assert.equal(safeHttpsUrl(url, base), undefined);
  }
  assert.equal(safeHttpsUrl('//example.org/ā', base), 'https://example.org/%C4%81');
  assert.equal(safeHttpsUrl('#citation', base), base + '#citation');
  const result = extract(wrap('<a href="jav&#x61;script:alert(1)">cross reference</a><a href="https://example.org/a?x=1&amp;y=2">safe</a>'));
  assert.deepEqual(result.links, ['https://example.org/a?x=1&y=2']);
  assert.equal(result.paragraphs[0], 'cross referencesafe');
});

test('missing, duplicate, mismatched, truncated, empty and hidden entry identities fail technically', () => {
  for (const html of ['<p>Error page</p>', wrap('text', 'n2'), wrap('a') + wrap('b'),
    '<div class="alpheios-lex-entry" lemma-id="n1">truncated', wrap(''),
    `<template>${wrap('hidden')}</template>`, '<svg><g class="alpheios-lex-entry" lemma-id="n1">hidden</g></svg>',
    '<div class="alpheios-lex-entry" lemma-id="n1" lemma-id="n2">ambiguous</div>']) {
    assert.throws(() => extract(html), formatFailure);
  }
  assert.throws(() => extractLatinArticle(wrap('text'), 'n1', 'https://example.org/'), formatFailure);
  assert.throws(() => latinArticleUrl('n1&l=bad'), formatFailure);
});

test('extraction preserves decoded literal markup as text and bounds bytes before HTML parsing', () => {
  const result = extract(wrap('<p>&lt;img src=x onerror=alert(1)&gt; mālum</p><p>ἅμα &amp; &quot;Latin&quot;</p>'));
  assert.deepEqual(result.paragraphs, ['<img src=x onerror=alert(1)> mālum', 'ἅμα & "Latin"']);
  assert.throws(() => extract('a'.repeat(requestLimits.articleBytes + 1)), error => error instanceof RequestFailure && error.kind === 'size');
  assert.deepEqual(extract(wrap('<span>'.repeat(1000) + 'deep' + '</span>'.repeat(1000))).paragraphs, ['deep']);
});
