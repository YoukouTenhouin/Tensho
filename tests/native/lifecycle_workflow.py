"""Worker interruption and permission acceptance; build with --lifecycle first.

Only transport payloads and delays are controlled. Shipping provider adapters,
permission guards, request executor, session storage and sidebar are production code.
"""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import threading
import time
import traceback
import urllib.request

from native_input import click, key
from permission_scope import CDP, QuietHandler
from reading_workflow import wait_for, version


def run(output):
    output.mkdir(parents=True, exist_ok=True)
    repo = Path(__file__).resolve().parents[2]
    evidence = {'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'browser': version(['microsoft-edge', '--version']), 'mode': 'isolated Xvfb / X11',
                'controlled_transport': True, 'production_provider_adapters': True, 'production_session_coordination_and_ui': True, 'checks': {}}
    checks = evidence['checks']; connections = []; browser = xvfb = server = None
    with tempfile.TemporaryDirectory(prefix='tensho-lifecycle-') as temporary:
        root = Path(temporary)
        # Match the documented unpacked-extension setup. Without Developer mode,
        # Edge can mark a command-line extension unsupported on the next launch.
        (root / 'profile/Default').mkdir(parents=True)
        (root / 'profile/Default/Preferences').write_text(json.dumps({'extensions': {'ui': {'developer_mode': True}}}))
        (root / 'reading.html').write_text('<!doctype html><title>Session reading</title><body style="height:4000px"><p>malum puella</p></body>')
        try:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=root))
            threading.Thread(target=server.serve_forever, daemon=True).start()
            url = f'http://127.0.0.1:{server.server_port}/reading.html'
            origin = f'http://127.0.0.1:{server.server_port}'
            extension = root / 'extension'; shutil.copytree(repo / 'dist-lifecycle', extension)
            with (output / 'browser.log').open('w') as log:
                reader, writer = os.pipe()
                xvfb = subprocess.Popen(['Xvfb', '-displayfd', str(writer), '-screen', '0', '1400x1000x24', '-nolisten', 'tcp'], pass_fds=(writer,), stdout=log, stderr=log)
                os.close(writer)
                if not select.select([reader], [], [], 10)[0]: raise RuntimeError('No isolated display')
                display = ':' + os.read(reader, 50).decode().strip(); os.close(reader)
                env = {**os.environ, 'DISPLAY': display}; env.pop('WAYLAND_DISPLAY', None)
                command = ['microsoft-edge', '--ozone-platform=x11', f'--user-data-dir={root}/profile', '--no-first-run', '--no-default-browser-check',
                           f'--disable-extensions-except={extension}', f'--load-extension={extension}', '--remote-debugging-port=0',
                           '--window-size=1300,900', '--window-position=0,0', url]
                port_file = root / 'profile/DevToolsActivePort'
                port = None
                def targets():
                    with urllib.request.urlopen(f'http://localhost:{port}/json/list', timeout=2) as response: return json.load(response)
                def target(suffix): return next((item for item in targets() if item['url'].endswith(suffix)), None)
                def connect(suffix):
                    item = wait_for(lambda: target(suffix)); cdp = CDP(item['webSocketDebuggerUrl']); connections.append(cdp); return cdp
                def launch():
                    nonlocal browser, port
                    port_file.unlink(missing_ok=True)
                    browser = subprocess.Popen(command, env=env, stdout=log, stderr=log)
                    wait_for(port_file.exists); port = int(port_file.read_text().splitlines()[0])
                    page_target = wait_for(lambda: next((item for item in targets() if item['type'] == 'page' and item['url'].startswith(origin)), None))
                    page = CDP(page_target['webSocketDebuggerUrl']); connections.append(page)
                    time.sleep(.3); key(display, 'Alt_L', 'Shift_L', 'k')
                    worker = connect('/worker.js')
                    panel = connect('/panel.html')
                    wait_for(lambda: panel.evaluate("document.querySelector('#active-settings')?.textContent.includes(' · ')"))
                    return worker, panel, page
                worker, panel, page = launch()
                snapshot_js = "(async()=>{const w=await chrome.windows.getCurrent();return chrome.runtime.sendMessage({type:'snapshot',windowId:w.id})})()"
                def snapshot(): return panel.evaluate(snapshot_js)
                def calls(): return worker.evaluate('globalThis.__tenshoLifecycleCalls ?? []')
                def choose(selector):
                    wait_for(lambda: panel.evaluate('!!document.querySelector(' + json.dumps(selector) + ')'))
                    panel.evaluate('document.querySelector(' + json.dumps(selector) + ').click()')
                def candidate(): return snapshot().get('dictionaries', {}).get('0', {})
                def reopen():
                    nonlocal panel
                    if not target('/panel.html'): key(display, 'Alt_L', 'Shift_L', 'k')
                    panel = connect('/panel.html')
                    wait_for(lambda: panel.evaluate("document.querySelector('#active-settings')?.textContent.includes(' · ')"))
                panel.evaluate("document.querySelector('#open-settings').click()")
                options = connect('/options.html')
                wait_for(lambda: options.evaluate("!!document.querySelector('#enable-providers')"))
                def source():
                    page.call('Page.bringToFront')
                    wait_for(lambda: snapshot().get('origin') == origin)
                source()
                def prompt(name, instruction):
                    options.call('Page.bringToFront')
                    options.call('Runtime.evaluate', expression="document.querySelector('#enable-providers').click()", userGesture=True)
                    time.sleep(.6)
                    if options.evaluate("document.querySelector('#enable-providers').hidden"):
                        evidence[name + '_native_prompt'] = 'previously approved grant restored without another prompt'
                        source(); return
                    path = output / (name + '.png')
                    subprocess.run(['import', '-display', display, '-window', 'root', str(path)], check=True)
                    print(f'{instruction}: inspect {path}, then enter X Y', flush=True)
                    x, y = map(int, input().split()); click(display, x, y); source()
                def start(text='malum'):
                    previous = snapshot().get('state', {}).get('generation', 0)
                    panel.evaluate("document.querySelector('#word').value=" + json.dumps(text) + ";document.querySelector('#lookup').requestSubmit()")
                    return wait_for(lambda: (lambda s: s if s and s['generation'] > previous else None)(snapshot().get('state')))
                def terminal(): return wait_for(lambda: (lambda s: s if s and s['status'] != 'loading' else None)(snapshot().get('state')))
                def resolution(status): return wait_for(lambda: (lambda r: r if r.get('status') == status else None)(candidate().get('resolution', {})))
                def article(entry, status): return wait_for(lambda: (lambda a: a if a.get('status') == status else None)(candidate().get('articles', {}).get(entry, {})))
                def stop_worker():
                    nonlocal worker
                    worker.ws.close()
                    page.call('ServiceWorker.enable'); page.call('ServiceWorker.stopAllWorkers')
                    wait_for(lambda: target('/worker.js') is None)
                    restored = snapshot(); worker = connect('/worker.js')
                    assert calls() == [], 'worker restart must not replay any pending transport'
                    return restored
                def hold(operation): worker.evaluate('globalThis.__tenshoLifecycleHold=' + json.dumps(operation))
                def release(): worker.evaluate("globalThis.__tenshoLifecycleHold=undefined;globalThis.__tenshoLifecycleRelease?.()")
                def revoke():
                    panel.evaluate("chrome.permissions.remove({origins:['https://repos1.alpheios.net/*']})")
                    wait_for(lambda: options.evaluate("document.querySelector('#provider-access').textContent.includes('revoked')"))

                start(); missing = terminal()
                checks['never_granted_access_blocks_all_transport'] = missing.get('failureKind') == 'missing-access' and calls() == []
                prompt('deny', 'Deny provider access')
                wait_for(lambda: options.evaluate("document.querySelector('#provider-access').textContent.includes('denied')"))
                start(); denied = terminal()
                checks['native_denial_visible_without_transport'] = denied.get('failureKind') == 'missing-access' and calls() == []
                prompt('grant', 'Allow the two Alpheios provider origins')
                wait_for(lambda: options.evaluate("document.querySelector('#enable-providers').hidden"))
                checks['native_grant_does_not_replay_denied_lookup'] = calls() == []
                hold('analysis'); start(); wait_for(lambda: len(calls()) == 1)
                assert snapshot()['state']['status'] == 'loading'
                restored = stop_worker()
                checks['actual_worker_stop_marks_pending_analysis_interrupted'] = restored['state'].get('failureKind') == 'interrupted'
                choose('#retry'); wait_for(lambda: terminal()['status'] == 'complete')
                checks['explicit_analysis_retry_uses_one_production_request'] = len(calls()) == 1 and calls()[0]['operation'] == 'analysis'
                completed = snapshot()['state']
                hold('index'); choose('#dictionary-0'); resolution('loading'); wait_for(lambda: len(calls()) == 2)
                restored = stop_worker()
                checks['actual_worker_stop_preserves_analysis_interrupts_resolution'] = restored['state'] == completed and restored['dictionaries']['0']['resolution'].get('failureKind') == 'interrupted'
                choose('#dictionary-retry-0'); resolution('complete')
                checks['explicit_resolution_retry_fetches_only_index'] = len(calls()) == 1 and calls()[0]['operation'] == 'index'
                choose('#article-0-n1'); first_article = article('n1', 'complete')
                hold('article'); choose('#article-0-n2'); article('n2', 'loading'); wait_for(lambda: len(calls()) == 3)
                restored = stop_worker()
                checks['actual_worker_stop_preserves_completed_article_interrupts_pending_sibling'] = restored['dictionaries']['0']['articles']['n1'] == first_article and restored['dictionaries']['0']['articles']['n2'].get('failureKind') == 'interrupted'
                choose('#article-0-n2'); article('n2', 'complete')
                checks['explicit_article_retry_does_not_replay_analysis_or_index'] = len(calls()) == 1 and calls()[0]['operation'] == 'article'
                all_completed = candidate()
                revoke()
                checks['backend_revocation_retains_all_completed_reading'] = candidate() == all_completed and snapshot()['state'] == completed
                start(); terminal(); choose('#dictionary-0'); blocked = resolution('error')
                checks['revoked_backend_blocks_cached_index_resolution'] = blocked.get('failureKind') == 'missing-access' and len(calls()) == 2
                choose('#dictionary-retry-0'); blocked = resolution('error')
                checks['retry_without_access_has_no_transport'] = blocked.get('failureKind') == 'missing-access' and len(calls()) == 2
                prompt('regrant', 'Allow provider access again')
                wait_for(lambda: options.evaluate("document.querySelector('#enable-providers').hidden"))
                checks['regrant_waits_for_explicit_retry'] = len(calls()) == 2
                choose('#dictionary-retry-0'); resolution('complete')
                checks['authorized_retry_can_reuse_fresh_index'] = len(calls()) == 2
                choose('#article-0-n1'); retained = article('n1', 'complete')
                hold('article'); choose('#article-0-n2'); article('n2', 'loading'); wait_for(lambda: len(calls()) == 4)
                revoke(); failed = article('n2', 'error')
                checks['native_revocation_aborts_pending_adapter_work'] = failed.get('failureKind') == 'revoked-access' and calls()[-1]['aborted']
                choose('#close'); wait_for(lambda: target('/panel.html') is None)
                release(); time.sleep(.3)
                checks['ignored_abort_late_response_does_not_reopen_panel'] = target('/panel.html') is None
                reopen()
                checks['ignored_abort_late_response_cannot_replace_failure_or_sibling'] = candidate()['articles']['n2'] == failed and candidate()['articles']['n1'] == retained
                choose('#article-0-n2'); article('n2', 'error')
                checks['revoked_article_retry_sends_no_request'] = len(calls()) == 4 and candidate()['articles']['n1'] == retained
                evidence['last_worker_transport_calls'] = calls()
                evidence['passed'] = all(checks.values())
        except Exception as error:
            evidence['failure'] = str(error); evidence['traceback'] = traceback.format_exc(); evidence['passed'] = False
            evidence['browser_exit'] = browser.poll() if browser else None
            try: evidence['targets'] = [{'type': item['type'], 'url': item['url']} for item in targets()]
            except Exception: pass
            for filename in ['Preferences', 'Secure Preferences']:
                try:
                    settings = json.loads((root / 'profile/Default' / filename).read_text()).get('extensions', {}).get('settings', {})
                    evidence[filename] = {id: {k: v.get(k) for k in ['state', 'disable_reasons', 'path', 'location']} for id, v in settings.items() if v.get('path') == str(extension)}
                except Exception: pass
            try:
                evidence['failure_snapshot'] = snapshot(); evidence['failure_body'] = panel.evaluate('document.body.innerText')
                evidence['failure_scroll'] = panel.evaluate('({y:window.scrollY,height:document.body.scrollHeight,viewport:innerHeight})')
            except Exception: pass
        finally:
            for connection in connections:
                try: connection.ws.close()
                except Exception: pass
            for process in [browser, xvfb]:
                if process:
                    process.terminate()
                    try: process.wait(timeout=8)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
            if server: server.shutdown(); server.server_close()
    (output / 'results.json').write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n')
    return evidence


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    result = run(parser.parse_args().output); print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
