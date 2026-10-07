"""Reading-site capture revocation acceptance; build with --controlled first.

Analysis payloads are controlled. Site permissions, injected scripts, capture,
worker coordination and native sidebar behavior use production code.
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
                'controlled_analysis': True, 'production_session_coordination_and_ui': True, 'checks': {}}
    checks = evidence['checks']; connections = []; browser = xvfb = server = None
    with tempfile.TemporaryDirectory(prefix='tensho-lifecycle-') as temporary:
        root = Path(temporary)
        # Match the documented unpacked-extension setup. Without Developer mode,
        # Edge can mark a command-line extension unsupported on the next launch.
        (root / 'profile/Default').mkdir(parents=True)
        (root / 'profile/Default/Preferences').write_text(json.dumps({'extensions': {'ui': {'developer_mode': True}}}))
        (root / 'reading.html').write_text('<!doctype html><title>Session reading</title><body style="height:4000px"><p style="font:24px serif">malum</p></body>')
        try:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=root))
            threading.Thread(target=server.serve_forever, daemon=True).start()
            url = f'http://127.0.0.1:{server.server_port}/reading.html'
            origin = f'http://127.0.0.1:{server.server_port}'
            extension = root / 'extension'; shutil.copytree(repo / 'dist-controlled', extension)
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
                frame_origin = f'http://localhost:{server.server_port}'
                origins = [origin + '/*', frame_origin + '/*']
                panel.call('Runtime.evaluate', expression='chrome.permissions.request({origins:' + json.dumps(origins) + '})', userGesture=True)
                time.sleep(.5)
                path = output / 'site-grant.png'
                subprocess.run(['import', '-display', display, '-window', 'root', str(path)], check=True)
                print(f'Inspect native site grant {path}, then enter Allow X Y', flush=True)
                x, y = map(int, input().split()); click(display, x, y)
                wait_for(lambda: panel.evaluate('chrome.permissions.contains({origins:' + json.dumps(origins) + '})'))
                panel.evaluate('chrome.storage.local.set({enabledOrigins:' + json.dumps([origin, frame_origin]) + '})')
                wait_for(lambda: panel.evaluate('chrome.scripting.getRegisteredContentScripts().then(s=>s[0]?.matches.length===2)'))
                page.evaluate("(()=>{const f=document.createElement('iframe');f.id='embedded';f.src=" + json.dumps(frame_origin + '/reading.html') + ";f.style.cssText='display:block;width:400px;height:100px';document.body.append(f)})()")
                wait_for(lambda: len(page.call('Page.getFrameTree')['frameTree'].get('childFrames', [])) == 1)
                time.sleep(.3)
                tab_id = snapshot()['tabId']
                # Observe actual selection reads in the existing isolated-world scripts.
                panel.evaluate('chrome.scripting.executeScript({target:{tabId:' + str(tab_id) + ',allFrames:true},func:()=>{const original=globalThis.getSelection;globalThis.getSelection=function(){document.documentElement.dataset.selectionReads=String(Number(document.documentElement.dataset.selectionReads??0)+1);return original.call(this)};document.documentElement.dataset.selectionReads="0"}})')
                def double_click(frame=False):
                    selector = '#embedded' if frame else 'p'
                    rect = page.evaluate('document.querySelector(' + json.dumps(selector) + ').getBoundingClientRect().toJSON()')
                    for count in [1, 2]:
                        for kind in ['mousePressed', 'mouseReleased']:
                            page.call('Input.dispatchMouseEvent', type=kind, x=rect['x']+20, y=rect['y']+15, button='left', clickCount=count)
                    key(display, 'Escape')
                double_click(True)
                wait_for(lambda: snapshot().get('state', {}).get('status') == 'complete')
                retained = snapshot()['state']
                checks['granted_embedded_frame_looks_up'] = retained['identity']['frameId'] != 0
                # Chromium CDP can inspect the same document without granting extension access.
                frame_target = wait_for(lambda: next((item for item in targets() if item['type'] == 'iframe' and item['url'].startswith(frame_origin)), None))
                frame_cdp = CDP(frame_target['webSocketDebuggerUrl']); connections.append(frame_cdp)
                def reads(frame=False):
                    return int((frame_cdp if frame else page).evaluate('document.documentElement.dataset.selectionReads'))
                # Empty trusted gestures must not suspend the completed result.
                page.evaluate("(()=>{getSelection().removeAllRanges();const b=document.createElement('button');b.id='empty-gesture';b.style.cssText='position:fixed;left:450px;top:400px;width:100px;height:100px;user-select:none';document.body.append(b)})()")
                for count in [1, 2]:
                    for kind in ['mousePressed', 'mouseReleased']:
                        page.call('Input.dispatchMouseEvent', type=kind, x=500, y=450, button='left', clickCount=count)
                time.sleep(.2)
                evidence['empty_gesture_selection'] = page.evaluate('getSelection().toString()')
                evidence['empty_gesture_state'] = snapshot()['state']
                checks['empty_gesture_preserves_current_result'] = snapshot()['state'] == retained
                choose('#dictionary-0')
                wait_for(lambda: snapshot().get('dictionaries', {}).get('0', {}).get('resolution', {}).get('status') == 'error')
                checks['empty_gesture_keeps_dictionary_actions_usable'] = True
                before = [reads(), reads(True)]
                # Hold a successful native permission answer across revocation.
                worker.evaluate("(()=>{const original=chrome.permissions.contains.bind(chrome.permissions);chrome.permissions.contains=async options=>{const granted=await original(options);if(options.origins?.length===2){globalThis.__captureAuthorizationHeld=true;await new Promise(resolve=>globalThis.__releaseCaptureAuthorization=resolve)}return granted}})()")
                double_click(True)
                wait_for(lambda: worker.evaluate('globalThis.__captureAuthorizationHeld===true'))
                panel.evaluate('chrome.permissions.remove({origins:' + json.dumps(origins) + '})')
                wait_for(lambda: panel.evaluate('chrome.scripting.getRegisteredContentScripts().then(s=>s.length===0)'))
                worker.evaluate('globalThis.__releaseCaptureAuthorization()')
                time.sleep(.2)
                checks['revocation_invalidates_pending_capture_authorization'] = [reads(), reads(True)] == before
                double_click(True); double_click()
                time.sleep(.2)
                after = [reads(), reads(True)]
                evidence['selection_reads_before_revocation'] = before
                evidence['selection_reads_after_revoked_double_clicks'] = after
                checks['revoked_scripts_do_not_capture_selection'] = after == before
                checks['revocation_preserves_completed_reading'] = snapshot()['state'] == retained
                checks['revoked_double_clicks_do_not_start_lookup'] = snapshot()['state']['generation'] == retained['generation']
                choose('#close'); wait_for(lambda: target('/panel.html') is None)
                double_click(True); double_click(); time.sleep(.2)
                checks['revoked_gestures_do_not_reopen_closed_panel'] = target('/panel.html') is None
                checks['closed_panel_revoked_gestures_do_not_capture'] = [reads(), reads(True)] == before
                reopen()
                checks['explicit_reopen_retains_completed_reading'] = snapshot()['state'] == retained
                # activeTab authorizes the top origin only; an old injected
                # receiver in a revoked cross-origin frame is not authorization.
                double_click(True)
                frame_reads = reads(True)
                key(display, 'Alt_L', 'Shift_L', 'l')
                wait_for(lambda: snapshot().get('state', {}).get('generation', 0) > retained['generation'])
                terminal = wait_for(lambda: (lambda state: state if state and state['status'] != 'loading' else None)(snapshot().get('state')))
                checks['keyboard_lookup_does_not_capture_revoked_cross_origin_frame'] = reads(True) == frame_reads
                checks['inaccessible_frame_selection_is_not_replaced_with_stale_text'] = terminal['status'] == 'notice'
                panel.evaluate("document.querySelector('#word').value='malum';document.querySelector('#lookup').requestSubmit()")
                completed = wait_for(lambda: (lambda state: state if state and state['status'] == 'complete' else None)(snapshot().get('state')))
                worker.evaluate("(()=>{const original=chrome.webNavigation.getAllFrames.bind(chrome.webNavigation);chrome.webNavigation.getAllFrames=async options=>{const frames=await original(options);chrome.webNavigation.getAllFrames=original;globalThis.__keyboardCaptureHeld=true;await new Promise(resolve=>globalThis.__releaseKeyboardCapture=resolve);return frames};chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.enabledOrigins)globalThis.__siteChangeObserved=true})})()")
                key(display, 'Alt_L', 'Shift_L', 'l')
                wait_for(lambda: worker.evaluate('globalThis.__keyboardCaptureHeld===true'))
                before_keyboard_release = [reads(), reads(True)]
                panel.evaluate('chrome.storage.local.set({enabledOrigins:[]})')
                wait_for(lambda: worker.evaluate('globalThis.__siteChangeObserved===true'))
                worker.evaluate('globalThis.__releaseKeyboardCapture()')
                time.sleep(.2)
                checks['site_change_during_keyboard_capture_prevents_text_read'] = [reads(), reads(True)] == before_keyboard_release
                checks['cancelled_keyboard_capture_retains_completed_analysis'] = snapshot()['state'] == completed
                choose('#dictionary-0')
                wait_for(lambda: snapshot().get('dictionaries', {}).get('0', {}).get('resolution', {}).get('status') == 'error')
                checks['cancelled_keyboard_capture_restores_dictionary_actions'] = True
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
