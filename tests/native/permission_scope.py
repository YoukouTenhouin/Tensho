"""Verify native Edge host-permission isolation with a disposable profile.

Requires Microsoft Edge and Python websocket-client. No provider calls, real
profile access, or desktop interaction. Uses real HTTP pages on two loopback
ports and probes native scripting access without application origin guards.
"""
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request

import websocket


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, suppress_origin=True, timeout=30)
        self.sequence = 0

    def call(self, method, **params):
        self.sequence += 1
        self.ws.send(json.dumps(dict(id=self.sequence, method=method, params=params)))
        while True:
            reply = json.loads(self.ws.recv())
            if reply.get('id') == self.sequence:
                if 'error' in reply:
                    raise RuntimeError(reply['error'])
                return reply['result']

    def evaluate(self, expression):
        result = self.call('Runtime.evaluate', expression=expression,
                           awaitPromise=True, returnByValue=True)
        if 'exceptionDetails' in result:
            raise RuntimeError(result['exceptionDetails'])
        return result['result'].get('value')


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def run():
    binary = shutil.which('microsoft-edge')
    if not binary:
        raise RuntimeError('Actual Microsoft Edge is required')
    with tempfile.TemporaryDirectory(prefix='tensho-native-scope-') as temporary:
        root = Path(temporary)
        (root / 'index.html').write_text('<!doctype html><title>Scope fixture</title><p>puella</p>')
        servers = [http.server.ThreadingHTTPServer(('127.0.0.1', 0),
                   functools.partial(QuietHandler, directory=root)) for _ in range(2)]
        for server in servers:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        urls = [f'http://127.0.0.1:{server.server_port}/index.html' for server in servers]
        pattern = f'http://127.0.0.1:{servers[0].server_port}/*'
        extension = root / 'extension'
        extension.mkdir()
        (extension / 'manifest.json').write_text(json.dumps({
            'manifest_version': 3, 'name': 'Tensho native permission acceptance',
            'version': '0.0.1', 'permissions': ['scripting', 'tabs'],
            'host_permissions': [pattern],
            'background': {'service_worker': 'worker.js'},
        }))
        (extension / 'probe.html').write_text('<!doctype html><title>Permission acceptance</title>')
        (extension / 'worker.js').write_text('chrome.runtime.onInstalled.addListener(()=>{});')
        browser = None
        cdp = None
        try:
            with (root / 'browser.log').open('w') as log:
                browser = subprocess.Popen([
                    binary, '--headless=new', f'--user-data-dir={root / "profile"}',
                    '--no-first-run', '--no-default-browser-check',
                    f'--disable-extensions-except={extension}', f'--load-extension={extension}',
                    '--remote-debugging-port=0', 'about:blank'], stdout=log, stderr=log)
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    try:
                        port = int((root / 'profile/DevToolsActivePort').read_text().splitlines()[0])
                        with urllib.request.urlopen(f'http://localhost:{port}/json/list', timeout=2) as response:
                            targets = json.load(response)
                        worker = next(t for t in targets if t['type'] == 'service_worker' and t['url'].endswith('/worker.js'))
                        break
                    except (OSError, ValueError, StopIteration):
                        if browser.poll() is not None:
                            raise RuntimeError((root / 'browser.log').read_text())
                        time.sleep(.1)
                else:
                    raise RuntimeError('Native extension did not load: ' + (root / 'browser.log').read_text())
                target = next(t for t in targets if t['type'] == 'page')
                cdp = CDP(target['webSocketDebuggerUrl'])
                extension_id = worker['url'].split('/')[2]
                cdp.call('Page.navigate', url=f'chrome-extension://{extension_id}/probe.html')
                for _ in range(100):
                    if cdp.evaluate("typeof chrome !== 'undefined' && !!chrome.permissions"):
                        break
                    time.sleep(.1)
                expression = '''(async()=>{
                  const urls=URLS;
                  const results=[];
                  for (const url of urls) {
                    const tab=await chrome.tabs.create({url});
                    for(let i=0;i<100;i++) {
                      if((await chrome.tabs.get(tab.id)).status==='complete') break;
                      await new Promise(resolve=>setTimeout(resolve,50));
                    }
                    const origin=new URL(url).origin;
                    let injection;
                    try {
                      injection=await chrome.scripting.executeScript({target:{tabId:tab.id},
                        func:()=>({origin:location.origin,text:document.querySelector('p').textContent})});
                    } catch(error) { injection={error:String(error)}; }
                    results.push({origin,contains:await chrome.permissions.contains({origins:[origin+'/*']}),injection});
                    await chrome.tabs.remove(tab.id);
                  }
                  return {manifest:chrome.runtime.getManifest(),granted:await chrome.permissions.getAll(),results};
                })()'''.replace('URLS', json.dumps(urls))
                result = cdp.evaluate(expression)
                assert result['manifest']['name'] == 'Tensho native permission acceptance'
                result['browser'] = subprocess.check_output([binary, '--version'], text=True).strip()
                result['observed_at_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
                result['environment'] = {'os': Path('/etc/os-release').read_text(),
                    'mode': 'headless Edge; native extension permissions, no KDE UI assertion'}
                result['exact_port_isolation'] = (
                    isinstance(result['results'][0]['injection'], list)
                    and isinstance(result['results'][1]['injection'], dict)
                    and not result['results'][1]['contains'])
                print(json.dumps(result, indent=2))
        finally:
            if cdp:
                cdp.ws.close()
            if browser:
                browser.terminate()
                try:
                    browser.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    browser.kill()
                    browser.wait()
            for server in servers:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    run()
