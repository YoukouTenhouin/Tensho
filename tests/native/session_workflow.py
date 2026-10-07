"""Retained reading acceptance in native Edge; build with --recovery first.

Provider payloads are controlled. Session storage, worker lifecycle, tab identity,
sidebar rendering, scroll and resource policy are production code.
"""
import argparse
import base64
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

from native_input import key
from permission_scope import CDP, QuietHandler
from reading_workflow import wait_for, version


def run(output, consistency=False, accessibility=False, i18n=False):
    output.mkdir(parents=True, exist_ok=True)
    repo = Path(__file__).resolve().parents[2]
    evidence = {'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'browser': version(['microsoft-edge', '--version']), 'mode': 'isolated Xvfb / X11',
                'controlled_providers': True, 'production_session_coordination_and_ui': True, 'checks': {}}
    checks = evidence['checks']; connections = []; browser = xvfb = server = None
    with tempfile.TemporaryDirectory(prefix='tensho-session-') as temporary:
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
            extension = root / 'extension'; shutil.copytree(repo / 'dist-recovery', extension)
            manifest = json.loads((extension / 'manifest.json').read_text()); manifest['host_permissions'] = [origin + '/*']
            (extension / 'manifest.json').write_text(json.dumps(manifest))
            evidence['fixture_permission'] = 'test-only exact-origin manifest pregrant for content-script privacy and site-setting persistence'
            with (output / 'browser.log').open('w') as log:
                reader, writer = os.pipe()
                xvfb = subprocess.Popen(['Xvfb', '-displayfd', str(writer), '-screen', '0', '1400x1000x24', '-nolisten', 'tcp'], pass_fds=(writer,), stdout=log, stderr=log)
                os.close(writer)
                if not select.select([reader], [], [], 10)[0]: raise RuntimeError('No isolated display')
                display = ':' + os.read(reader, 50).decode().strip(); os.close(reader)
                env = {**os.environ, 'DISPLAY': display, 'LANGUAGE': 'en_US.UTF-8'}; env.pop('WAYLAND_DISPLAY', None)
                if i18n: env['LANGUAGE'] = 'zh_CN.UTF-8'
                command = ['microsoft-edge', '--ozone-platform=x11', f'--user-data-dir={root}/profile', '--no-first-run', '--no-default-browser-check',
                           f'--disable-extensions-except={extension}', f'--load-extension={extension}', '--remote-debugging-port=0',
                           '--window-size=1300,900', '--window-position=0,0', url]
                if i18n: command.insert(1, '--lang=zh-CN')
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
                def calls(): return worker.evaluate('globalThis.__tenshoRecoveryCalls ?? []')
                def choose(selector): panel.evaluate('document.querySelector(' + json.dumps(selector) + ').click()')
                def submit(text):
                    panel.evaluate("document.querySelector('#word').value=" + json.dumps(text) + ";document.querySelector('#lookup').requestSubmit()")
                    return wait_for(lambda: (lambda s: s if s and s['status'] == 'complete' and s['text'] == text else None)(snapshot().get('state')))
                def candidate(): return snapshot().get('dictionaries', {}).get('0', {})
                def scroll_panel(y):
                    panel.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                    panel.evaluate('window.scrollTo(0,' + str(y) + ')')
                    wait_for(lambda: snapshot()['scroll']['y'] == y)
                def reopen():
                    nonlocal panel
                    if not target('/panel.html'): key(display, 'Alt_L', 'Shift_L', 'k')
                    panel = connect('/panel.html')
                    wait_for(lambda: panel.evaluate("document.querySelector('#active-settings')?.textContent.includes(' · ')"))
                def close_browser():
                    try: page.call('Browser.close')
                    except Exception: pass
                    browser.wait(timeout=10)
                    for connection in connections: connection.ws.close()
                    connections.clear()

                if i18n:
                    from i18n_workflow import exercise_i18n
                    exercise_i18n(evidence, worker, panel, page, connect, target, display, output, close_browser, launch)
                elif accessibility:
                    from accessibility_workflow import exercise_accessibility
                    exercise_accessibility(evidence, panel, worker, page, snapshot, display, target)
                elif consistency:
                    from consistency_workflow import exercise_consistency
                    exercise_consistency(evidence, lambda: panel, worker, page, snapshot, submit, reopen, connect, target, url)
                else:
                    page.evaluate('window.scrollTo(0,800)')
                    worker.evaluate("globalThis.__tenshoRecoveryScenario='session-long'")
                    first = submit('malum'); first_tab = snapshot()['tabId']
                    choose('#dictionary-0'); wait_for(lambda: candidate().get('resolution', {}).get('status') == 'complete')
                    choose('#article-0-n1'); wait_for(lambda: candidate().get('articles', {}).get('n1', {}).get('status') == 'complete')
                    wait_for(lambda: panel.evaluate("Array.from(document.querySelectorAll('.dictionary-article p')).some(p=>p.textContent.startsWith('100. Complete'))"))
                    (output/'expanded-reading.png').write_bytes(base64.b64decode(panel.call('Page.captureScreenshot')['data']))
                    scroll_panel(900)
                    before_calls = calls(); first_dictionary = candidate()
                    checks['source_page_position_unchanged'] = page.evaluate('window.scrollY') == 800
                    checks['session_contains_complete_reading_only'] = panel.evaluate("chrome.storage.session.get('readingResults').then(v=>v.readingResults.tabs[" + str(first_tab) + "].value.state.text==='malum')")
                    checks['local_storage_has_no_selected_text'] = panel.evaluate("chrome.storage.local.get(null).then(v=>!JSON.stringify(v).includes('malum'))")
                    checks['content_script_cannot_read_session_collection'] = panel.evaluate("chrome.scripting.executeScript({target:{tabId:" + str(first_tab) + "},func:async()=>{try{await chrome.storage.session.get('readingResults');return false}catch{return true}}}).then(r=>r.length===1&&r[0].result===true)")
                    choose('#close'); wait_for(lambda: target('/panel.html') is None); reopen()
                    wait_for(lambda: panel.evaluate('window.scrollY') == 900)
                    checks['native_close_reopen_restores_content_scroll_without_requests'] = candidate() == first_dictionary and calls() == before_calls and snapshot()['state'] == first
                    checks['close_reopen_preserves_source_page_position'] = page.evaluate('window.scrollY') == 800
                    choose('#dictionary-0'); wait_for(lambda: candidate().get('expanded') is False)
                    choose('#close'); wait_for(lambda: target('/panel.html') is None); reopen()
                    checks['collapsed_state_survives_native_reopen'] = candidate().get('expanded') is False and calls() == before_calls
                    choose('#dictionary-0'); wait_for(lambda: candidate().get('expanded') is True)
                    scroll_panel(700)

                    second_tab = panel.evaluate('chrome.tabs.create({url:' + json.dumps(url + '?second') + ',active:true}).then(t=>t.id)')
                    reopen(); wait_for(lambda: snapshot()['tabId'] == second_tab)
                    checks['new_tab_never_shows_first_result'] = snapshot().get('state') is None
                    second = submit('puella')
                    panel.evaluate('chrome.tabs.update(' + str(first_tab) + ',{active:true})'); reopen()
                    wait_for(lambda: snapshot()['tabId'] == first_tab)
                    checks['switch_back_restores_first_result'] = snapshot()['state'] == first and candidate()['articles']['n1']['status'] == 'complete'
                    before_calls = calls()
                    worker.ws.close()
                    page.call('ServiceWorker.enable'); page.call('ServiceWorker.stopAllWorkers')
                    wait_for(lambda: target('/worker.js') is None)
                    # A new extension message wakes a genuinely stopped worker.
                    restored = snapshot(); worker = connect('/worker.js')
                    checks['worker_restart_restores_completed_state_without_requests'] = restored['state'] == first and restored['dictionaries']['0']['articles']['n1']['status'] == 'complete' and calls() == []
                    checks['worker_restart_restores_panel_position'] = restored['scroll']['y'] == 700
                    page.evaluate("history.pushState({},'',location.pathname+'#same-document')")
                    checks['same_document_navigation_retains_result'] = snapshot()['state'] == first and calls() == []
                    worker.evaluate("globalThis.__tenshoRecoveryScenario='session-overflow'")
                    choose('#article-0-n2'); wait_for(lambda: candidate().get('articles', {}).get('n2', {}).get('status') == 'not-retained')
                    checks['oversized_article_preserves_completed_article'] = candidate()['articles']['n1']['status'] == 'complete'
                    checks['oversized_article_offers_validated_source'] = panel.evaluate("Array.from(document.querySelectorAll('a')).some(a=>a.textContent==='Read complete article at source' && a.href==='https://fixture.invalid/d-first/n2' && a.rel==='noopener noreferrer')")
                    checks['actual_serialized_session_within_six_mib'] = panel.evaluate("chrome.storage.session.get('readingResults').then(v=>new TextEncoder().encode(JSON.stringify(v)).byteLength<=6*1024*1024)")
                    panel.evaluate('chrome.tabs.update(' + str(second_tab) + ',{active:true})'); reopen()
                    wait_for(lambda: snapshot()['tabId'] == second_tab)
                    checks['oversized_article_preserves_other_tab'] = snapshot()['state'] == second
                    panel.evaluate('chrome.tabs.update(' + str(first_tab) + ',{active:true})'); reopen()
                    wait_for(lambda: snapshot()['tabId'] == first_tab)
                    page.call('Page.reload'); wait_for(lambda: snapshot().get('state') is None)
                    checks['reload_clears_reading_state'] = snapshot().get('dictionaries') == {}
                    submit('legi')
                    page.call('Page.navigate', url=url + '?different-document'); wait_for(lambda: snapshot().get('state') is None)
                    checks['different_document_clears_reading_state'] = snapshot().get('dictionaries') == {}
                    panel.evaluate("document.querySelector('#word').value='sessionpending';document.querySelector('#lookup').requestSubmit()")
                    wait_for(lambda: snapshot().get('state', {}).get('status') == 'loading')
                    choose('#close'); wait_for(lambda: target('/panel.html') is None)
                    wait_for(lambda: worker.evaluate("chrome.storage.session.get('readingResults').then(v=>v.readingResults.tabs[" + str(first_tab) + "]?.value.state.status==='complete')"))
                    checks['pending_completion_does_not_reopen_sidebar'] = target('/panel.html') is None
                    before_calls = calls(); reopen()
                    checks['reopen_uses_completion_retained_while_closed'] = snapshot()['state']['text'] == 'sessionpending' and snapshot()['state']['status'] == 'complete' and calls() == before_calls
                    panel.evaluate("(async()=>{const w=await chrome.windows.getCurrent();return chrome.runtime.sendMessage({type:'save-origin',windowId:w.id,origin:" + json.dumps(origin) + ",enabled:true})})()")
                    wait_for(lambda: origin in snapshot()['enabledOrigins'])
                    before_settings = snapshot()['settings']
                    close_browser(); worker, panel, page = launch()
                    checks['browser_restart_clears_session_reading'] = panel.evaluate("chrome.storage.session.get('readingResults').then(v=>!Object.values(v.readingResults?.tabs??{}).some(t=>t.status==='retained'))") and snapshot().get('state') is None
                    checks['browser_restart_preserves_local_settings'] = snapshot()['settings'] == before_settings
                    checks['browser_restart_preserves_site_enablement'] = origin in snapshot()['enabledOrigins']
                    checks['browser_restart_sends_no_lookup'] = calls() == []
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
    parser.add_argument('--consistency', action='store_true')
    parser.add_argument('--accessibility', action='store_true')
    parser.add_argument('--i18n', action='store_true')
    args = parser.parse_args()
    result = run(args.output, args.consistency, args.accessibility, args.i18n); print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
