#!/usr/bin/env python3
"""Offline content extraction plus actual Edge DOM probe, with a disposable profile.

No raw provider markup is sent to the browser. This bounded research path trades
rich HTML formatting for readable text and separately validated HTTPS links.
"""
import importlib.util
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from urllib.parse import urljoin, urlsplit
import urllib.request

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('prior_edge', HERE.parent / 'issue-10-probes/edge_probe.py')
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
FULL = 'https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n='


def safe_url(value, base):
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    try:
        value = urljoin(base, value)
        parsed = urlsplit(value)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            return None
        # Accessing port rejects invalid/out-of-range port strings.
        parsed.port
        return value
    except ValueError:
        return None


class Readable(HTMLParser):
    OMIT = {'script', 'style', 'iframe', 'object', 'svg', 'math', 'template', 'noscript', 'head'}
    BLOCK = {'div', 'p', 'br', 'li', 'ul', 'ol', 'table', 'tr', 'h1', 'h2', 'h3', 'blockquote'}

    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.parts, self.links, self.omitted = base, [], [], []

    def handle_starttag(self, tag, attrs):
        if self.omitted:
            if tag in self.OMIT:
                self.omitted.append(tag)
            return
        if tag in self.OMIT:
            self.omitted.append(tag)
            return
        if tag in self.BLOCK:
            self.parts.append('\n')
        if tag == 'a':
            href = safe_url(dict(attrs).get('href', ''), self.base)
            if href and href not in self.links:
                self.links.append(href)

    def handle_endtag(self, tag):
        if self.omitted:
            if tag == self.omitted[-1]:
                self.omitted.pop()
            return
        if tag in self.BLOCK:
            self.parts.append('\n')

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data):
        if not self.omitted:
            # Provider indentation/line wrapping is not a paragraph boundary.
            self.parts.append(re.sub(r'\s+', ' ', data))

    def result(self):
        lines = [re.sub(r'\s+', ' ', line).strip() for line in ''.join(self.parts).splitlines()]
        return dict(text='\n'.join(line for line in lines if line), links=self.links,
                    sourceUrl=safe_url(self.base, self.base))


RENDER = r"""(items => {
  document.body.replaceChildren();
  for (const item of items) {
    const section = document.createElement('section');
    const content = document.createElement('pre');
    content.style.whiteSpace = 'pre-wrap';
    content.textContent = item.text;
    section.append(content);
    for (const raw of [item.sourceUrl, ...item.links]) {
      if (typeof raw !== 'string' || /[\u0000-\u0020\u007f]/.test(raw)) continue;
      let url; try { url = new URL(raw); } catch { continue; }
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) continue;
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = raw === item.sourceUrl ? 'Dictionary source' : url.href;
      section.append(link, document.createTextNode('\n'));
    }
    document.body.append(section);
  }
  return {
    sections: document.querySelectorAll('section').length,
    text: Array.from(document.querySelectorAll('pre'), el => el.textContent),
    urls: Array.from(document.querySelectorAll('a'), el => ({href:el.href,rel:el.rel,target:el.target})),
    elementTags: Array.from(new Set(Array.from(document.body.querySelectorAll('*'), el => el.tagName))),
    providerAttributeCount: Array.from(document.body.querySelectorAll('*')).flatMap(el => Array.from(el.attributes)).filter(a => /^on/i.test(a.name)||['src','srcdoc','id','name'].includes(a.name)).length,
    active: window.providerActive
  };
})"""


def main():
    old = json.loads((HERE.parent / 'issue-10-probes/provider-results.json').read_text())
    new = json.loads((HERE / 'resolver-evidence.json').read_text())
    articles = [r for r in old['dictionary'] + new['newArticles'] if r['status'] == 200]
    items = []
    for article in articles:
        parser = Readable(article['url'])
        parser.feed(article['body'])
        item = parser.result()
        assert 'A Latin Dictionary' in item['text'] and 'Lewis' in item['text'] and 'Short' in item['text']
        assert len(item['text']) > 80 and item['sourceUrl'] == article['url']
        items.append(item)
    hostile = '''<div onclick="window.providerActive++" style="background:url(https://attacker.invalid/a)">Readable &amp; Latin mālum</div>
      <script>window.providerActive++</script><img src="https://attacker.invalid/a" onerror="window.providerActive++">
      <iframe srcdoc="<script>parent.providerActive++</script>"></iframe><object data="https://attacker.invalid/b"></object>
      <svg onload="window.providerActive++"><script>window.providerActive++</script></svg>
      <style>@import 'https://attacker.invalid/c';</style><template><img src="x"></template>
      <a href="javascript:window.providerActive++">bad script</a><a href="jav&#x61;script:alert(1)">entity</a>
      <a href="data:text/html,boom">bad data</a><a href="https://user:pass@example.org/">credentials</a>
      <a href="//repos1.alpheios.net/safe">relative safe</a><a href="https://alpheios.net/pages/apiterms/">safe citation</a>
      <p>Attribution: Lewis &amp; Short</p><math><mtext><img src=x onerror="window.providerActive++"></mtext></math>'''
    parser = Readable(FULL + 'n27774')
    parser.feed(hostile)
    adversarial = parser.result()
    assert 'Readable & Latin mālum' in adversarial['text'] and 'Attribution: Lewis & Short' in adversarial['text']
    assert 'window.providerActive' not in adversarial['text']
    assert adversarial['links'] == ['https://repos1.alpheios.net/safe', 'https://alpheios.net/pages/apiterms/']
    # Also challenge the browser boundary directly; extraction is not a trust boundary.
    adversarial['links'] += ['javascript:window.providerActive++', 'data:text/html,boom',
                              'https://user:pass@example.org/', 'https://example.org/\nonclick=x',
                              '<img src=x onerror="window.providerActive++">']
    adversarial['text'] += '\n<img src=x onerror="window.providerActive++">'
    items.append(adversarial)
    binary = shutil.which('microsoft-edge') or shutil.which('microsoft-edge-stable')
    assert binary, 'Actual Microsoft Edge required'
    port = 9245
    with tempfile.TemporaryDirectory(prefix='tensho-issue12-render-') as directory:
        with (Path(directory) / 'browser.log').open('w') as log:
            process = subprocess.Popen([binary, '--headless=new', '--no-first-run', '--no-default-browser-check',
                '--disable-background-networking', '--disable-extensions', '--user-data-dir=' + directory + '/profile',
                f'--remote-debugging-port={port}', f'--remote-allow-origins=http://localhost:{port}', 'about:blank'], stdout=log, stderr=log)
            try:
                for _ in range(100):
                    try:
                        with urllib.request.urlopen(f'http://localhost:{port}/json/list', timeout=2) as r:
                            target = next(t for t in json.load(r) if t['type'] == 'page')
                        break
                    except (OSError, StopIteration):
                        time.sleep(.1)
                else:
                    raise RuntimeError('Browser did not start')
                cdp = prior.CDP(target['webSocketDebuggerUrl'], port)
                # Positive control: ordinary page permits inline event handlers; CSP is not masking failure.
                control = cdp.evaluate('''(() => { window.providerActive=0; const c=document.createElement('div'); c.innerHTML='<button onclick="window.providerActive++">test</button>'; document.body.append(c); c.firstChild.click(); return window.providerActive; })()''')
                assert control == 1
                cdp.evaluate('window.providerActive=0')
                result = cdp.evaluate(RENDER + '(' + json.dumps(items) + ')')
                time.sleep(.25)
                assert cdp.evaluate('window.providerActive') == 0
                assert result['text'] == [item['text'] for item in items]
                assert result['providerAttributeCount'] == 0 and result['active'] == 0
                assert set(result['elementTags']) == {'SECTION', 'PRE', 'A'}
                assert len(result['urls']) == sum(1 + len(item['links']) for item in items) - 5
                assert all(u['href'].startswith('https:') and u['rel'] == 'noopener noreferrer' and u['target'] == '_blank' for u in result['urls'])
                cdp.ws.close()
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
    result.update(status='PASS', browserVersion=subprocess.check_output([binary, '--version'], text=True).strip(),
                  observedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  inlineHandlerPositiveControl=control, actualArticles=len(articles),
                  limits='Plain text and separate safe links; no production extension integration, visual-layout audit, or exhaustive sanitizer proof')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
