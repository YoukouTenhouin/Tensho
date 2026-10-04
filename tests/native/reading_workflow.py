"""Exercise the built extension in disposable, visible Microsoft Edge.

Run `npm run build`, then `python3 tests/native/reading_workflow.py [--desktop]`.
Default: isolated Xvfb. --desktop: existing DISPLAY, e.g. KDE's Xwayland.
Requires Edge, Python websocket-client, and Xvfb for the isolated mode.
A test-only copy pregrants exactly the ephemeral loopback fixture origin;
this checks native reading/focus, not the optional permission prompt.
Returns nonzero when a required behavior fails and prints structured evidence.
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
import urllib.request

from permission_scope import CDP, QuietHandler


def wait_for(predicate, seconds=10):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.05)
    raise RuntimeError('Timed out waiting for native browser state')


def version(command):
    return subprocess.check_output(command, text=True, stderr=subprocess.STDOUT).strip()


def run(desktop):
    repo = Path(__file__).resolve().parents[2]
    evidence = {'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'browser': version(['microsoft-edge', '--version']),
                'mode': 'KDE desktop / Xwayland' if desktop else 'isolated Xvfb / X11',
                'controlled_analysis': True,
                'fixture_permission': 'test-only exact-origin manifest pregrant; optional prompting tested separately',
                'checks': {}}
    if desktop:
        evidence['desktop'] = version(['plasmashell', '--version'])
        evidence['window_manager'] = version(['kwin_wayland', '--version'])
        evidence['session_type'] = os.environ.get('XDG_SESSION_TYPE')
    with tempfile.TemporaryDirectory(prefix='tensho-reading-acceptance-') as temporary:
        root = Path(temporary)
        (root / 'index.html').write_text('''<!doctype html><meta charset="utf-8"><title>Reading fixture</title>
<style>body{font:24px serif;padding:30px}p{margin:35px 0}input{font-size:24px}</style>
<h1>Latin reading</h1><p id="word" tabindex="0">puella</p><p id="second">legi malum mālum</p>
<input id="editable" value="puellae"><div style="height:1800px"></div><p>finis</p>''')
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=root))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        frame_server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=root))
        threading.Thread(target=frame_server.serve_forever, daemon=True).start()
        frame_origin = f'http://127.0.0.1:{frame_server.server_port}'
        (root / 'frame.html').write_text('<!doctype html><meta charset="utf-8"><style>body{font:24px serif;margin:8px}p{margin:0}</style><p tabindex="0">servus</p>')
        origin = f'http://127.0.0.1:{server.server_port}'
        url = origin + '/index.html'
        extension = root / 'extension'
        shutil.copytree(repo / 'dist', extension)
        manifest = json.loads((extension / 'manifest.json').read_text())
        manifest['host_permissions'] = [origin + '/*', frame_origin + '/*']
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        xvfb = browser = None
        connections = []
        try:
            with (root / 'browser.log').open('w') as log:
                display = os.environ.get('DISPLAY')
                if not desktop:
                    reader, writer = os.pipe()
                    xvfb = subprocess.Popen(['Xvfb', '-displayfd', str(writer), '-screen', '0', '1400x1000x24', '-nolisten', 'tcp'], pass_fds=(writer,), stdout=log, stderr=log)
                    os.close(writer)
                    if not select.select([reader], [], [], 10)[0]:
                        raise RuntimeError('Xvfb did not start')
                    display = ':' + os.read(reader, 50).decode().strip()
                    os.close(reader)
                env = {**os.environ, 'DISPLAY': display}
                env.pop('WAYLAND_DISPLAY', None)
                browser = subprocess.Popen(['microsoft-edge', '--ozone-platform=x11', f'--user-data-dir={root}/profile',
                    '--no-first-run', '--no-default-browser-check', f'--disable-extensions-except={extension}',
                    f'--load-extension={extension}', '--remote-debugging-port=0', '--window-size=1300,900', url],
                    env=env, stdout=log, stderr=log)
                port_file = root / 'profile/DevToolsActivePort'
                wait_for(port_file.exists)
                port = int(port_file.read_text().splitlines()[0])

                def targets():
                    with urllib.request.urlopen(f'http://localhost:{port}/json/list', timeout=2) as response:
                        return json.load(response)

                def target(suffix):
                    return next((t for t in targets() if t['url'].endswith(suffix)), None)

                def connect(item):
                    cdp = CDP(item['webSocketDebuggerUrl']); connections.append(cdp); return cdp

                worker = wait_for(lambda: target('/worker.js'))
                extension_id = worker['url'].split('/')[2]
                reading = connect(wait_for(lambda: target('/index.html')))
                # Initialize only local site preferences through an extension context.
                reading.call('Page.navigate', url=f'chrome-extension://{extension_id}/panel.html')
                wait_for(lambda: reading.evaluate("typeof chrome !== 'undefined' && !!chrome.storage"))
                reading.evaluate('chrome.storage.local.set({enabledOrigins:[' + json.dumps(origin) + ']})')
                wait_for(lambda: reading.evaluate('chrome.scripting.getRegisteredContentScripts().then(s=>s.length===1)'))
                evidence['commands'] = reading.evaluate('chrome.commands.getAll()')
                evidence['checks']['both_shortcuts_registered'] = all(any(c['name'] == name and c['shortcut'] for c in evidence['commands']) for name in ['lookup-selection', 'focus-results'])
                reading.call('Page.navigate', url=url)
                wait_for(lambda: reading.evaluate("!!document.querySelector('#word')"))
                # Allow document_idle content script execution, then bring the reading page forward.
                time.sleep(.2)
                reading.call('Page.bringToFront')
                evidence['before'] = reading.evaluate('({focus:document.hasFocus(),scroll:scrollY})')

                def double_click(selector):
                    rect = reading.evaluate(f'document.querySelector({json.dumps(selector)}).getBoundingClientRect().toJSON()')
                    for count in [1, 2]:
                        for kind in ['mousePressed', 'mouseReleased']:
                            reading.call('Input.dispatchMouseEvent', type=kind, x=rect['x'] + 20, y=rect['y'] + 12, button='left', clickCount=count)

                double_click('#word')
                panel = connect(wait_for(lambda: target('/panel.html')))
                wait_for(lambda: panel.evaluate("document.querySelector('#status')?.textContent === 'Controlled development response'"))
                evidence['after_double_click'] = reading.evaluate('({focus:document.hasFocus(),active:document.activeElement.id,scroll:scrollY})')
                evidence['panel_after_double_click'] = panel.evaluate('({focus:document.hasFocus(),active:document.activeElement.id,target:document.querySelector("#target").textContent})')
                checks = evidence['checks']
                checks['double_click_result'] = evidence['panel_after_double_click']['target'] == 'puella'
                checks['double_click_native_focus_allowed'] = evidence['after_double_click']['focus'] or evidence['panel_after_double_click']['focus']
                checks['double_click_preserves_scroll'] = evidence['before']['scroll'] == evidence['after_double_click']['scroll']
                snapshot = "(async()=>{const w=await chrome.windows.getCurrent();return chrome.runtime.sendMessage({type:'snapshot',windowId:w.id})})()"
                double_click('#second')
                wait_for(lambda: panel.evaluate("document.querySelector('#target').textContent==='legi' && document.querySelector('#status').textContent==='Controlled development response'"))
                checks['already_open_panel_lookup_preserves_page_focus'] = reading.evaluate('document.hasFocus()')
                initial = panel.evaluate(snapshot)
                # Dragging ordinary text produces no replacement lookup.
                reading.call('Input.dispatchMouseEvent', type='mousePressed', x=40, y=242, button='left', clickCount=1)
                reading.call('Input.dispatchMouseEvent', type='mouseMoved', x=180, y=242, buttons=1)
                reading.call('Input.dispatchMouseEvent', type='mouseReleased', x=180, y=242, button='left', clickCount=1)
                time.sleep(.1)
                checks['drag_does_not_lookup'] = panel.evaluate(snapshot)['state']['generation'] == initial['state']['generation']
                double_click('#editable'); time.sleep(.1)
                checks['editable_double_click_does_not_lookup'] = panel.evaluate(snapshot)['state']['generation'] == initial['state']['generation']
                checks['page_click_keeps_panel_open'] = target('/panel.html') is not None
                panel.evaluate("""(()=>{
                  window.loadingAnnouncements=[];
                  const status=document.querySelector('#status');
                  new MutationObserver(()=>{
                    if(status.textContent.includes('Loading')) loadingAnnouncements.push({
                      role:status.getAttribute('role'),blocked:!!status.closest('[aria-busy=true]')});
                  }).observe(status,{childList:true,subtree:true,characterData:true});
                })()""")
                panel.evaluate("document.querySelector('#word').value='mālum'")
                panel.call('Runtime.evaluate', expression="document.querySelector('#lookup').requestSubmit()", userGesture=True)
                wait_for(lambda: panel.evaluate("document.querySelector('#target').textContent==='mālum' && document.querySelector('#status').textContent==='Controlled development response'"))
                checks['manual_lookup_through_production_interface'] = True
                announcements = panel.evaluate('loadingAnnouncements')
                evidence['loading_announcements'] = announcements
                checks['loading_status_can_be_announced'] = bool(announcements) and all(a['role'] == 'status' and not a['blocked'] for a in announcements)
                panel.call('Runtime.evaluate', expression="document.querySelector('#close').click()", userGesture=True)
                wait_for(lambda: target('/panel.html') is None)
                checks['close_restores_page_focus'] = reading.evaluate('document.hasFocus()')
                # A pending controlled completion cannot reopen a closed panel.
                double_click('#word')
                panel = connect(wait_for(lambda: target('/panel.html')))
                wait_for(lambda: panel.evaluate("!!document.querySelector('#close')"))
                panel.call('Runtime.evaluate', expression="document.querySelector('#close').click()", userGesture=True)
                wait_for(lambda: target('/panel.html') is None)
                time.sleep(.5)
                checks['closed_panel_stays_closed_after_completion'] = target('/panel.html') is None
                # Frame paths use the same production content script and worker.
                double_click('#word')
                panel = connect(wait_for(lambda: target('/panel.html')))
                wait_for(lambda: panel.evaluate("document.querySelector('#status')?.textContent === 'Controlled development response'"))
                frame_urls = {'same': origin + '/frame.html?same', 'embedded': frame_origin + '/frame.html?embedded', 'opaque': origin + '/frame.html?opaque'}
                reading.evaluate("""(()=>{for(const [id,url] of Object.entries(URLS)) {
                  const frame=document.createElement('iframe');frame.id=id;frame.src=url;
                  frame.style.cssText='display:block;width:400px;height:80px;margin:20px 0';
                  if(id==='opaque') frame.sandbox='allow-scripts';
                  document.body.prepend(frame);
                }})()""".replace('URLS', json.dumps(frame_urls)))
                wait_for(lambda: len(reading.call('Page.getFrameTree')['frameTree'].get('childFrames', [])) == 3)
                time.sleep(.2)

                def frame_double_click(frame_id):
                    reading.evaluate(f'document.getElementById({json.dumps(frame_id)}).scrollIntoView({{block:"center"}})')
                    rect = reading.evaluate(f'document.getElementById({json.dumps(frame_id)}).getBoundingClientRect().toJSON()')
                    for count in [1, 2]:
                        for kind in ['mousePressed', 'mouseReleased']:
                            reading.call('Input.dispatchMouseEvent', type=kind, x=rect['x']+25, y=rect['y']+20, button='left', clickCount=count)

                before = panel.evaluate(snapshot)['state']['generation']
                frame_double_click('embedded'); time.sleep(.15)
                checks['embedded_origin_requires_explicit_enablement'] = panel.evaluate(snapshot)['state']['generation'] == before
                frame_double_click('same')
                wait_for(lambda: panel.evaluate(snapshot)['state']['text'] == 'servus')
                same = panel.evaluate(snapshot)['state']
                checks['same_origin_frame_routes_identity'] = same['identity']['frameId'] != 0 and same['identity']['documentId'] != same['identity']['topDocumentId']
                # Explicit settings action names the embedded origin before requesting access.
                panel.evaluate("document.querySelector('details').open=true;document.querySelector('#origin').value=" + json.dumps(frame_origin))
                panel.call('Runtime.evaluate', expression="document.querySelector('#site').requestSubmit()", userGesture=True)
                wait_for(lambda: frame_origin in panel.evaluate('chrome.storage.local.get("enabledOrigins").then(s=>s.enabledOrigins)'))
                wait_for(lambda: panel.evaluate('chrome.scripting.getRegisteredContentScripts().then(s=>s[0]?.matches.length===2)'))
                time.sleep(.1)
                frame_double_click('embedded')
                wait_for(lambda: panel.evaluate(snapshot)['state']['identity']['frameId'] != same['identity']['frameId'])
                embedded = panel.evaluate(snapshot)['state']
                checks['separately_enabled_frame_routes_identity'] = embedded['text'] == 'servus' and embedded['identity']['frameId'] != 0
                before = embedded['generation']
                frame_double_click('opaque'); time.sleep(.15)
                checks['opaque_sandbox_frame_does_not_lookup'] = panel.evaluate(snapshot)['state']['generation'] == before
                panel.evaluate('chrome.storage.local.set({enabledOrigins:[' + json.dumps(frame_origin) + ']})')
                wait_for(lambda: panel.evaluate('chrome.scripting.getRegisteredContentScripts().then(s=>s[0]?.matches.length===1)'))
                before = panel.evaluate(snapshot)['state']['generation']
                frame_double_click('embedded'); time.sleep(.15)
                checks['embedded_frame_requires_containing_site_enablement'] = panel.evaluate(snapshot)['state']['generation'] == before
                evidence['frame_identities'] = {'same_origin': same['identity'], 'separate_origin': embedded['identity']}
                evidence['passed'] = all(checks.values())
                return evidence
        finally:
            for cdp in connections:
                cdp.ws.close()
            for process in [browser, xvfb]:
                if process:
                    process.terminate()
                    try:
                        process.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.wait()
            server.shutdown(); server.server_close()
            frame_server.shutdown(); frame_server.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--desktop', action='store_true')
    args = parser.parse_args()
    result = run(args.desktop)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
