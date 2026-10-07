// Research-only inert section extraction; deliberately not installed in src/.
import { parseFragment } from 'parse5';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const directory = new URL('./', import.meta.url);
const records = JSON.parse(readFileSync(new URL('provider-results.json', directory)));
const omitted = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template',
  'noscript', 'audio', 'video', 'canvas', 'link', 'meta']);
const blocks = new Set(['div', 'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dd', 'dt', 'br', 'tr']);
const descendants = node => [node, ...(node.childNodes ?? []).flatMap(descendants)];
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');
function extract(html) {
  const parsed = parseFragment(html);
  const root = descendants(parsed).find(n => n.attrs?.some(a => a.name === 'class' && a.value.split(' ').includes('mw-parser-output')));
  if (!root) throw Error('Missing parser root');
  let selected = false, found = false;
  const parts = [], links = new Set();
  function walk(node) {
    if (omitted.has(node.tagName) || (node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml')) return;
    if (node.nodeName === '#text') { parts.push(node.value.replace(/\s+/g, ' ')); return; }
    if (blocks.has(node.tagName)) parts.push('\n');
    if (node.tagName === 'a') {
      const href = node.attrs.find(a => a.name === 'href')?.value;
      if (href && !/[\u0000-\u0020\u007f]/u.test(href)) {
        try {
          const url = new URL(href, 'https://zh.wiktionary.org/');
          if (url.protocol === 'https:' && !url.username && !url.password) links.add(url.href);
        } catch { /* Omit unsafe links, retain readable text. */ }
      }
    }
    for (const child of node.childNodes ?? []) walk(child);
    if (blocks.has(node.tagName)) parts.push('\n');
  }
  for (const child of root.childNodes) {
    const heading = child.tagName === 'h2' ? child : child.tagName === 'div'
      ? child.childNodes?.find(n => n.tagName === 'h2') : undefined;
    if (heading) {
      selected = ['英语', '英語'].includes(text(heading).trim());
      if (selected) found = true;
    }
    if (selected) walk(child);
  }
  return { found, paragraphs: parts.join('').split('\n').map(s => s.trim()).filter(Boolean), links: [...links] };
}
const outputs = records.map(row => ({ word: row.word, variant: row.variant,
  revid: row.payload.parse?.revid, ...(row.payload.parse ? extract(row.payload.parse.text) : { error: row.payload.error }) }));
const get = (word, variant = 'zh-hans') => outputs.find(r => r.word === word && r.variant === variant);
assert.ok(get('book').paragraphs.join('\n').includes('预订'));
assert.ok(get('book', 'zh-hant').paragraphs.join('\n').includes('預訂'));
assert.ok(get('gift').paragraphs.join('\n').includes('礼物'));
assert.ok(!get('gift').paragraphs.join('\n').includes('丹麦语'));
assert.ok(!get('go').paragraphs.includes('法语'));
assert.ok(get("don't").found && get('ice-cream').found);
assert.equal(get('tenshoxyzunknown').error.code, 'missingtitle');
assert.equal(get("he's").error.code, 'missingtitle');
assert.ok(get('I').paragraphs.includes('我') && get('the').found && get('is').found);
assert.equal(get('水').found, false);
assert.deepEqual(get('水').paragraphs, []);
assert.ok(outputs.filter(r => r.found).every(r => r.links.every(link => link.startsWith('https://'))));
// Hostile controlled markup never becomes an active browser element.
assert.deepEqual(extract('<div class="mw-parser-output"><h2>英语</h2><p onclick="bad()">kept<script>bad()</script><a href="javascript:bad()">word</a></p><h2>德语</h2><p>foreign</p></div>').paragraphs, ['英语', 'keptword']);
writeFileSync(new URL('extraction-results.json', directory), JSON.stringify({ passed: true, outputs }, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, entries: outputs.length, englishSections: outputs.filter(r => r.found).length }));
