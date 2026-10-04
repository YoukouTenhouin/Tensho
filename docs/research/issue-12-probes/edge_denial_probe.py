"""Observe denial of a real Edge optional-host prompt in a disposable X11 display.

Requires Edge, Xvfb, ImageMagick import, libX11/libXtst, websocket-client.
Run with --output /tmp/edge-denial. Inspect prompt.png, then enter the screen
coordinates of its Deny button. --deny-at X Y supports a previously inspected
layout; never use it blindly after changing browser, locale, or window geometry.
The script never uses the user's browser profile or desktop display.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'issue-10-probes'))
from edge_probe import CDP, HOSTS, fetch_expression


def click_native(display, x, y):
    x11 = ctypes.CDLL('libX11.so.6')
    xtest = ctypes.CDLL('libXtst.so.6')
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    xtest.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int,
                                         ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
    xtest.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint,
                                         ctypes.c_int, ctypes.c_ulong]
    connection = x11.XOpenDisplay(display.encode())
    if not connection:
        raise RuntimeError('Cannot open isolated display')
    try:
        xtest.XTestFakeMotionEvent(connection, -1, x, y, 0)
        xtest.XTestFakeButtonEvent(connection, 1, 1, 0)
        xtest.XTestFakeButtonEvent(connection, 1, 0, 0)
        x11.XFlush(connection)
    finally:
        x11.XCloseDisplay(connection)


def stop(process):
    if process is None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def run(output, deny_at):
    binary = shutil.which('microsoft-edge') or shutil.which('microsoft-edge-stable')
    if not binary:
        raise RuntimeError('Actual Microsoft Edge required')
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='tensho-issue12-denial-') as temporary:
        root = Path(temporary)
        extension = root / 'extension'
        extension.mkdir()
        manifest = {'manifest_version': 3, 'name': 'Tensho native denial probe',
                    'version': '0.0.1', 'optional_host_permissions': HOSTS,
                    'background': {'service_worker': 'worker.js'}}
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        (extension / 'worker.js').write_text('chrome.runtime.onInstalled.addListener(()=>{});')
        (extension / 'probe.html').write_text(
            '<!doctype html><html><body><button>Request backend access</button>'
            '<pre></pre><script src="probe.js"></script></body></html>')
        (extension / 'probe.js').write_text('''
window.events=[];
document.querySelector('button').onclick=async()=>{
  events.push({event:'requested',active:navigator.userActivation.isActive});
  try {
    const granted=await chrome.permissions.request({origins:HOSTS});
    events.push({event:'resolved',granted,permissions:await chrome.permissions.getAll()});
  } catch(e) { events.push({error:String(e)}); }
  document.querySelector('pre').textContent=JSON.stringify(events);
};'''.replace('HOSTS', json.dumps(HOSTS)))
        reader, writer = os.pipe()
        xvfb = browser = None
        page = None
        with (root / 'browser.log').open('w') as log:
            try:
                xvfb = subprocess.Popen(['Xvfb', '-displayfd', str(writer), '-screen',
                                         '0', '1280x900x24', '-nolisten', 'tcp'],
                                        pass_fds=(writer,), stdout=log, stderr=log)
                os.close(writer)
                import select
                if not select.select([reader], [], [], 10)[0]:
                    raise RuntimeError('Xvfb did not provide a display')
                with os.fdopen(reader) as stream:
                    display = ':' + stream.readline().strip()
                env = {**os.environ, 'DISPLAY': display}
                env.pop('WAYLAND_DISPLAY', None)
                browser = subprocess.Popen([
                    binary, '--ozone-platform=x11', f'--user-data-dir={root / "profile"}',
                    '--no-first-run', '--no-default-browser-check',
                    f'--disable-extensions-except={extension}', f'--load-extension={extension}',
                    '--remote-debugging-port=0', '--remote-allow-origins=http://localhost',
                    '--window-size=1200,800', '--window-position=0,0', 'about:blank'],
                    env=env, stdout=log, stderr=log)
                port_file = root / 'profile' / 'DevToolsActivePort'
                for _ in range(150):
                    try:
                        port = int(port_file.read_text().splitlines()[0])
                        base = f'http://localhost:{port}'
                        with urllib.request.urlopen(base + '/json/list', timeout=2) as response:
                            targets = json.load(response)
                        worker = next(t for t in targets if t['url'].endswith('/worker.js'))
                        target = next(t for t in targets if t['type'] == 'page')
                        break
                    except (OSError, StopIteration, ValueError):
                        if browser.poll() is not None:
                            raise RuntimeError((root / 'browser.log').read_text())
                        time.sleep(.1)
                else:
                    raise RuntimeError('Edge extension did not load')
                # Existing CDP helper uses a port-specific Origin; allow the exact origin
                # by connecting with suppress_origin, then use its existing protocol methods.
                import websocket
                page = CDP.__new__(CDP)
                page.ws = websocket.create_connection(target['webSocketDebuggerUrl'],
                                                       suppress_origin=True, timeout=30)
                page.sequence = 0
                extension_id = worker['url'].split('/')[2]
                page.call('Page.navigate', url=f'chrome-extension://{extension_id}/probe.html')
                for _ in range(100):
                    if page.evaluate("typeof events !== 'undefined'"):
                        break
                    time.sleep(.1)
                else:
                    raise RuntimeError('Probe page did not initialize')
                result = {'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                          'browser_version': subprocess.check_output([binary, '--version'], text=True).strip(),
                          'manifest': manifest, 'mode': 'headed X11 on isolated Xvfb',
                          'initial_guarded': page.evaluate(fetch_expression(True))}
                page.call('Input.dispatchMouseEvent', type='mousePressed', x=85, y=18,
                          button='left', clickCount=1)
                page.call('Input.dispatchMouseEvent', type='mouseReleased', x=85, y=18,
                          button='left', clickCount=1)
                time.sleep(1)
                result['while_prompt_pending'] = page.evaluate('events')
                assert result['while_prompt_pending'] == [{'event': 'requested', 'active': True}]
                subprocess.run(['import', '-window', 'root', str(output / 'prompt.png')],
                               env=env, check=True)
                print(f'Inspect native dialog: {output / "prompt.png"}', file=sys.stderr, flush=True)
                if deny_at is None:
                    deny_at = tuple(map(int, input('Deny button screen coordinates X Y: ').split()))
                assert len(deny_at) == 2 and 0 <= deny_at[0] < 1280 and 0 <= deny_at[1] < 900
                click_native(display, *deny_at)
                for _ in range(100):
                    events = page.evaluate('events')
                    if len(events) > 1:
                        break
                    time.sleep(.1)
                result['native_click'] = {'screen_x': deny_at[0], 'screen_y': deny_at[1],
                                          'method': 'XTest pointer click on visually inspected Deny button'}
                result['after_denial_events'] = events
                result['after_denial_guarded'] = page.evaluate(fetch_expression(True))
                subprocess.run(['import', '-window', 'root', str(output / 'after-denial.png')],
                               env=env, check=True)
                assert len(events) == 2 and events[1].get('granted') is False, events
                assert result['initial_guarded']['fetches'] == 0
                assert result['after_denial_guarded']['fetches'] == 0
                assert result['after_denial_guarded']['permissions']['origins'] == []
                result['passed'] = True
                (output / 'edge-denial-results.json').write_text(json.dumps(result, indent=2) + '\n')
                print(json.dumps(result, indent=2))
            finally:
                if page:
                    page.ws.close()
                stop(browser)
                stop(xvfb)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--deny-at', type=int, nargs=2)
    args = parser.parse_args()
    run(args.output.resolve(), args.deny_at)
