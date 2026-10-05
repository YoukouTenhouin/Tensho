#!/usr/bin/env python3
"""Offline research boundary: historical records -> inert JSON; no article resolver."""
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.parse import urlencode, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 1024 * 1024
BLOCKS = {'div', 'p', 'br'}
FORBIDDEN = {'script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math'}
KNOWN = {'s', 's1', 'lex', 'ab', 'ls', 'lang', 'bot', 'bio', 'etym', 'hom', 'i', 'b', 'ns', 'pcol', 'pc', 'pb', 'info', 'div', 'p', 'br', 'root', 'chg', 'old', 'new'}

class InertText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []; self.suppressed = []; self.unknown = set(); self.annotations = []
    def handle_starttag(self, tag, attrs):
        if self.suppressed:
            if tag in FORBIDDEN: self.suppressed.append(tag)
            return
        if tag in FORBIDDEN:
            self.suppressed.append(tag); return
        if tag not in KNOWN:
            self.unknown.add(tag)
            self.annotations.append({'tag':tag, 'attributes':dict(attrs), 'uninterpreted':True})
        if tag in BLOCKS: self.parts.append('\n\n')
        if tag in {'old', 'new'}: self.parts.append('\n\n[' + ('superseded text' if tag == 'old' else 'replacement text') + '] ')
        if tag in {'info', 'pb', 'srs', 'shortlong'}: self.annotations.append({'tag':tag, 'attributes':dict(attrs)})
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)
    def handle_endtag(self, tag):
        if self.suppressed:
            if tag == self.suppressed[-1]: self.suppressed.pop()
            return
        if tag in BLOCKS: self.parts.append('\n\n')
    def handle_data(self, data):
        if not self.suppressed: self.parts.append(data)
    def result(self):
        return [re.sub(r'\s+', ' ', p).strip() for p in ''.join(self.parts).split('\n\n') if p.strip()]


def text(fragment):
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)', fragment, re.I):
        raise ValueError('DTD/entity declarations are not accepted')
    p = InertText(); p.feed(fragment); p.close()
    return p


def source_url(record_id):
    if not re.fullmatch(r'\d+(?:\.\d+)?', record_id): raise ValueError('Invalid record ID')
    url = 'https://www.sanskrit-lexicon.uni-koeln.de/scans/awork/apidev/getword_xml.php?' + urlencode({'dict':'mw','lnum':record_id,'input':'slp1','output':'roman'})
    parsed = urlsplit(url)
    assert parsed.scheme == 'https' and parsed.netloc == 'www.sanskrit-lexicon.uni-koeln.de'
    return url


def record(raw):
    # Only a bounded, structurally recognised record envelope is accepted. The
    # real fixture contains malformed inline XML; a tolerant TEXT tokenizer is
    # used inside the envelope, never a document/DOM or HTML renderer.
    if len(raw.encode()) > MAX_BYTES: raise ValueError('Record too large')
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)', raw, re.I): raise ValueError('DTD/entity declaration')
    m = re.fullmatch(r'<(H[1-4][ABCE]?)><h>(.*?)</h><body>(.*?)</body><tail><L>(\d+(?:\.\d+)?)</L><pc>(.*?)</pc></tail></\1>', raw, re.S)
    if not m: raise ValueError('Unrecognised record envelope')
    code, header, body, ident, page = m.groups()
    def field(name):
        found = re.search('<'+name+'>(.*?)</'+name+'>', header, re.S)
        return ' '.join(text(found[1]).result()) if found else None
    p = text(body)
    try: ET.fromstring(raw); strict = True
    except ET.ParseError: strict = False
    return {'recordId':ident, 'hierarchy':code, 'key1':field('key1'), 'key2':field('key2'), 'homograph':field('hom'), 'pageColumn':page, 'paragraphs':p.result(), 'annotations':p.annotations, 'unknownTags':sorted(p.unknown), 'strictXmlValid':strict, 'sourceLink':source_url(ident), 'completeArticleVerified':False}


def run():
    provenance = json.loads((ROOT/'article-provenance.json').read_text())
    output = {'attribution':provenance['attribution'], 'license':provenance['license'], 'transformations':provenance['transformations'], 'cases':[]}
    for meta in provenance['responses']:
        data = (ROOT/meta['file']).read_bytes()
        assert len(data) == meta['bytes'] < MAX_BYTES
        assert hashlib.sha256(data).hexdigest() == meta['sha256']
        wire = json.loads(data)
        assert wire['status'] == 200 and wire['dict'] == 'mw'
        assert len(wire['xml']) == len(wire['html'])
        records = [record(x) for x in wire['xml']]
        output['cases'].append({'case':meta['case'], 'canonicalKey':wire['key'], 'records':records})
    assert [len(c['records']) for c in output['cases']] == [10,23,3]
    by_id = {r['recordId']:r for c in output['cases'] for r in c['records']}
    assert by_id['161698']['hierarchy'] == 'H2' and by_id['161698']['homograph'] == '4'
    assert by_id['161686.10']['recordId'] == '161686.10'
    assert by_id['897.05']['hierarchy'] == 'H1A'
    assert not by_id['161686.05']['strictXmlValid']
    assert set(r['hierarchy'] for r in by_id.values()) == {'H1','H1A','H1B','H1E','H2','H3','H3B'}
    attack = text('<p>before <a href="javascript:alert(1)" onclick="evil()">visible</a><script>BAD</script><img src="https://invalid.example/" onerror="evil()"> after</p><p>next</p>')
    assert attack.result() == ['before visible after','next']
    for bad in ['1&dict=pw', 'javascript:alert(1)', '161686.10/../']:
        try: source_url(bad)
        except ValueError: pass
        else: raise AssertionError('Unsafe source ID accepted')
    try: text('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>')
    except ValueError: pass
    else: raise AssertionError('DTD accepted')
    output['validation'] = {'responseHashesVerified':3, 'recordsRetained':36, 'strictXmlInvalidIds':[k for k,v in by_id.items() if not v['strictXmlValid']], 'inertAttackControl':'passed', 'decimalIdentityControl':'passed', 'fullArticleBoundaryValidation':'unresolved', 'networkRequests':0}
    return output

if __name__ == '__main__':
    print(json.dumps(run(), ensure_ascii=False, indent=2))
