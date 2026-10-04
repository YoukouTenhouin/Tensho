import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { RequestFailure, requestLimits } from '../core/requests.ts';
import { safeHttpsUrl } from '../core/safe-links.ts';
import { latinDictionary } from './latin-index.ts';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
export interface DictionaryArticle {
  dictionary: string;
  entryId: string;
  paragraphs: string[];
  attribution: string[];
  links: string[];
  sourceUrl: string;
}
const omitted = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
  'template', 'noscript', 'head', 'audio', 'video', 'canvas']);
const blocks = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li',
  'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tr', 'ul']);
const isElement = (node: Node): node is Element => 'tagName' in node;
const attribute = (node: Element, name: string) => node.attrs.find(item => item.name === name)?.value;
const hasClass = (node: Element, name: string) => attribute(node, 'class')?.split(/\s+/).includes(name);
const skip = (node: Element) => node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || omitted.has(node.tagName);

export function latinArticleUrl(entryId: string): string {
  if (!/^n[0-9]+$/.test(entryId)) throw new RequestFailure('format', 'Invalid dictionary entry identifier.');
  const url = new URL(latinDictionary.articleUrl);
  url.search = new URLSearchParams({ lx: 'ls', lg: 'lat', out: 'html', n: entryId }).toString();
  return url.href;
}

/** No DOM, resource loader, or HTML serialization is involved in extraction. */
export function extractLatinArticle(html: string, entryId: string, requestUrl: string): DictionaryArticle {
  if (new TextEncoder().encode(html).byteLength > requestLimits.articleBytes) {
    throw new RequestFailure('size', 'Dictionary article exceeds the 1 MiB decoded response limit.');
  }
  const sourceUrl = safeHttpsUrl(requestUrl);
  if (sourceUrl !== latinArticleUrl(entryId)) throw new RequestFailure('format', 'Dictionary article source does not match its request.');
  let malformed = false;
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true, onParseError: () => { malformed = true; } });
  const entries: Element[] = [], credits: Element[] = [];
  const pending: Node[] = [fragment];
  while (pending.length) {
    const node = pending.pop()!;
    if (isElement(node)) {
      if (skip(node)) continue;
      if (hasClass(node, 'alpheios-lex-entry')) entries.push(node);
      if (hasClass(node, 'alpheios-lex-alph-source')) credits.push(node);
    }
    if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]!);
  }
  if (malformed || entries.length !== 1 || attribute(entries[0]!, 'lemma-id') !== entryId || !entries[0]!.sourceCodeLocation?.endTag) {
    throw new RequestFailure('format', 'Dictionary article identity or format does not match the chosen entry.');
  }
  const links = new Set<string>();
  const paragraphs = readable(fragment, sourceUrl, links);
  if (!readable(entries[0]!, sourceUrl, new Set()).length) throw new RequestFailure('format', 'Dictionary article contains no readable entry text.');
  return { dictionary: latinDictionary.name, entryId, paragraphs,
    attribution: credits.flatMap(credit => readable(credit, sourceUrl, new Set())), links: [...links], sourceUrl };
}

/** Iterative traversal also handles deeply nested bounded input without recursion. */
function readable(root: Node, base: string, links: Set<string>): string[] {
  const parts: string[] = [];
  const pending: { node: Node; end: boolean }[] = [{ node: root, end: false }];
  while (pending.length) {
    const { node, end } = pending.pop()!;
    if (isElement(node)) {
      if (skip(node)) continue;
      if (blocks.has(node.tagName)) parts.push('\n');
      if (node.tagName === 'td' || node.tagName === 'th') parts.push(' ');
      if (end) continue;
      if (node.tagName === 'a') {
        const href = safeHttpsUrl(attribute(node, 'href') ?? '', base);
        if (href) links.add(href);
      }
    } else if ('value' in node && node.nodeName === '#text') {
      // Provider wrapping/indentation is not a paragraph boundary. Keep Unicode.
      parts.push(node.value.replace(/[\t\n\f\r ]+/g, ' '));
    }
    if (end) continue;
    if ('childNodes' in node) {
      pending.push({ node, end: true });
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push({ node: node.childNodes[i]!, end: false });
    }
  }
  return parts.join('').split('\n').map(line => line.replace(/[\t\f\r ]+/g, ' ').trim()).filter(Boolean);
}
