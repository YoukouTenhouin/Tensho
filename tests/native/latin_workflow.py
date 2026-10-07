"""Production Latin access and live lookup acceptance on isolated Xvfb.

Run after build: python3 tests/native/latin_workflow.py --output /tmp/tensho-latin
Inspect saved native prompts and enter their button coordinates when requested.
Only the fixed word 'important' is sent to the provider, after an actual grant.
"""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import threading
import time
import urllib.request

from native_input import click, key
from permission_scope import CDP, QuietHandler
from reading_workflow import wait_for, version


class ObservedCDP(CDP):
    def __init__(self, url):
        super().__init__(url)
        self.events = []

    def call(self, method, **params):
        self.sequence += 1
        self.ws.send(json.dumps(dict(id=self.sequence, method=method, params=params)))
        while True:
            reply = json.loads(self.ws.recv())
            if 'method' in reply:
                self.events.append(reply)
            if reply.get('id') == self.sequence:
                if 'error' in reply:
                    raise RuntimeError(reply['error'])
                return reply['result']


def run(output, dictionary=False, passage=False):
    output.mkdir(parents=True, exist_ok=True)
    repo = Path(__file__).resolve().parents[2]
    evidence = {'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'browser': version(['microsoft-edge', '--version']), 'mode': 'isolated Xvfb',
                'unmodified_production_build': True, 'live_provider_word': 'important', 'checks': {}}
    checks = evidence['checks']
    connections = []
    browser = xvfb = server = None
    with tempfile.TemporaryDirectory(prefix='tensho-latin-') as temporary:
        root = Path(temporary)
        (root/'index.html').write_text('<!doctype html><title>Latin reading fixture</title><p>important</p>')
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=root))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{server.server_port}/index.html'
        try:
            with (output/'browser.log').open('w') as log:
                reader, writer = os.pipe()
                xvfb = subprocess.Popen(['Xvfb', '-displayfd', str(writer), '-screen', '0', '1400x1000x24', '-nolisten', 'tcp'], pass_fds=(writer,), stdout=log, stderr=log)
                os.close(writer)
                if not select.select([reader], [], [], 10)[0]: raise RuntimeError('No isolated display')
                display = ':' + os.read(reader, 50).decode().strip(); os.close(reader)
                env = {**os.environ, 'DISPLAY': display, 'LANGUAGE': 'en_US.UTF-8'}; env.pop('WAYLAND_DISPLAY', None)
                browser = subprocess.Popen(['microsoft-edge', '--ozone-platform=x11', f'--user-data-dir={root}/profile', '--no-first-run', '--no-default-browser-check',
                    f'--disable-extensions-except={repo}/dist', f'--load-extension={repo}/dist', '--remote-debugging-port=0', '--window-size=1300,900', '--window-position=0,0', url], env=env, stdout=log, stderr=log)
                port_file = root/'profile/DevToolsActivePort'; wait_for(port_file.exists)
                port = int(port_file.read_text().splitlines()[0])
                def targets():
                    with urllib.request.urlopen(f'http://localhost:{port}/json/list', timeout=2) as response: return json.load(response)
                def target(suffix): return next((item for item in targets() if item['url'].endswith(suffix)), None)
                def connect(item):
                    c = ObservedCDP(item['webSocketDebuggerUrl']); connections.append(c); return c
                worker = connect(wait_for(lambda: target('/worker.js')))
                worker.call('Network.enable')
                reading = connect(wait_for(lambda: target('/index.html')))
                reading.call('Page.bringToFront')
                key(display, 'Alt_L', 'Shift_L', 'k')
                panel = connect(wait_for(lambda: target('/panel.html')))
                snapshot = "(async()=>{const w=await chrome.windows.getCurrent();return chrome.runtime.sendMessage({type:'snapshot',windowId:w.id})})()"
                wait_for(lambda: panel.evaluate("document.querySelector('#active-settings')?.textContent.includes(' · ')"))
                panel.evaluate("document.querySelector('#open-settings').click()")
                options = connect(wait_for(lambda: target('/options.html')))
                wait_for(lambda: options.evaluate("document.querySelector('#provider-access')?.textContent.includes('disabled')"))
                def source():
                    reading.call('Page.bringToFront')
                    wait_for(lambda: panel.evaluate(snapshot).get('origin') == f'http://127.0.0.1:{server.server_port}')
                source()
                def requests():
                    worker.evaluate('0')
                    return [event['params']['request'] for event in worker.events if event.get('method') == 'Network.requestWillBeSent'
                            and event['params']['request']['url'].startswith(('https://morph.alpheios.net/', 'https://repos1.alpheios.net/'))]
                def submit():
                    previous = panel.evaluate(snapshot).get('state', {}).get('generation', 0)
                    panel.evaluate("document.querySelector('#word').value='important';document.querySelector('#lookup').requestSubmit()")
                    return wait_for(lambda: (lambda state: state if state and state['generation'] > previous and state['status'] != 'loading' else None)(panel.evaluate(snapshot).get('state')), seconds=35)
                def retry():
                    previous = panel.evaluate(snapshot)['state']['generation']
                    panel.evaluate("document.querySelector('#retry').click()")
                    return wait_for(lambda: (lambda state: state if state and state['generation'] > previous and state['status'] != 'loading' else None)(panel.evaluate(snapshot).get('state')), seconds=35)
                checks['setup_sends_no_provider_requests'] = len(requests()) == 0
                missing = submit()
                checks['missing_access_visible_without_request'] = missing.get('failureKind') == 'missing-access' and len(requests()) == 0
                def prompt(name, instruction):
                    options.call('Page.bringToFront')
                    options.call('Runtime.evaluate', expression="document.querySelector('#enable-providers').click()", userGesture=True)
                    time.sleep(.6)
                    path = output/(name+'.png')
                    subprocess.run(['import', '-display', display, '-window', 'root', str(path)], check=True)
                    print(f'{instruction}: inspect {path}, then enter X Y', flush=True)
                    a, b = map(int, input().split()); click(display, a, b)
                prompt('deny', 'Deny Latin provider access')
                wait_for(lambda: options.evaluate("document.querySelector('#provider-access').textContent.includes('denied')"))
                source(); denied = submit()
                checks['denial_visible_without_request'] = denied.get('failureKind') == 'missing-access' and len(requests()) == 0
                prompt('grant', 'Allow access to the two displayed Alpheios origins')
                wait_for(lambda: options.evaluate("document.querySelector('#enable-providers').hidden"))
                checks['grant_does_not_automatically_lookup'] = len(requests()) == 0
                evidence['granted_origins'] = panel.evaluate('chrome.permissions.getAll().then(p=>p.origins)')
                checks['exact_default_provider_origins'] = sorted(evidence['granted_origins']) == ['https://morph.alpheios.net/*', 'https://repos1.alpheios.net/*']
                source(); live = retry(); evidence['live_state'] = live
                checks['explicit_retry_after_grant_completes'] = live['status'] == 'complete'
                checks['live_latin_importo_analysis'] = live['status'] == 'complete' and live['analysis']['candidates'][0]['lemma'].startswith('importo,')
                checks['live_attribution_visible'] = options.evaluate("document.querySelector('#source-credits').textContent.includes('William Whitaker')")
                checks['english_short_meanings_visible'] = panel.evaluate("document.querySelector('#analysis').textContent.includes('bring in')")
                observed = requests(); evidence['provider_requests'] = observed
                checks['one_explicit_latin_request'] = len(observed) == 1 and 'engine=whitakerLat' in observed[0]['url'] and 'lang=lat' in observed[0]['url']
                if dictionary:
                    from dictionary_workflow import exercise_dictionary
                    exercise_dictionary(panel, snapshot, requests, evidence)
                if passage:
                    from passage_workflow import exercise_live_passage
                    exercise_live_passage(panel, snapshot, requests, evidence)
                request_count = len(requests())
                panel.evaluate("chrome.permissions.remove({origins:['https://morph.alpheios.net/*','https://repos1.alpheios.net/*']})")
                wait_for(lambda: options.evaluate("document.querySelector('#provider-access').textContent.includes('revoked')"))
                revoked = submit()
                checks['revocation_visible_without_new_request'] = revoked.get('failureKind') == 'missing-access' and len(requests()) == request_count
                retried_revoked = retry()
                checks['retry_after_revocation_sends_no_request'] = retried_revoked.get('failureKind') == 'missing-access' and len(requests()) == request_count
                checks['explicit_retry_is_available'] = panel.evaluate("!document.querySelector('#retry').hidden")
                evidence['passed'] = all(checks.values())
        except Exception as error:
            evidence['failure'] = str(error); evidence['passed'] = False
        finally:
            for c in connections: c.ws.close()
            for process in [browser, xvfb]:
                if process:
                    process.terminate()
                    try: process.wait(timeout=8)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
            if server: server.shutdown(); server.server_close()
    (output/'results.json').write_text(json.dumps(evidence, indent=2, ensure_ascii=False)+'\n')
    return evidence


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--dictionary', action='store_true')
    parser.add_argument('--passage', action='store_true')
    args = parser.parse_args(); result = run(args.output, args.dictionary, args.passage); print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
