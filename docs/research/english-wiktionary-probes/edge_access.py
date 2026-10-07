"""One official API call from a disposable, headless Edge MV3 worker.

Uses a pregranted research manifest, not production permissions or prompt acceptance.
"""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[2] / 'tests/native'))
from permission_scope import CDP

result = {'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
          'mode': 'headless Edge; disposable MV3 extension; research pregrant',
          'production_acceptance': False}
with tempfile.TemporaryDirectory(prefix='tensho-english-research-') as temporary:
    root = Path(temporary)
    ext = root / 'extension'
    ext.mkdir()
    (ext / 'manifest.json').write_text(json.dumps({
        'manifest_version': 3, 'name': 'Tensho English research', 'version': '0.0.1',
        'permissions': ['storage'], 'host_permissions': ['https://zh.wiktionary.org/*'],
        'background': {'service_worker': 'worker.js'}}))
    (ext / 'worker.js').write_text('chrome.runtime.onInstalled.addListener(()=>{});')
    browser = None
    cdp = None
    try:
        with (root / 'browser.log').open('w') as log:
            browser = subprocess.Popen(['microsoft-edge', '--headless=new',
                '--no-first-run', '--no-default-browser-check',
                f'--user-data-dir={root}/profile', f'--disable-extensions-except={ext}',
                f'--load-extension={ext}', '--remote-debugging-port=0', 'about:blank'],
                stdout=log, stderr=log)
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                try:
                    port = int((root / 'profile/DevToolsActivePort').read_text().splitlines()[0])
                    with urlopen(f'http://localhost:{port}/json/list', timeout=2) as response:
                        worker = next(t for t in json.load(response) if t['type'] == 'service_worker' and t['url'].endswith('/worker.js'))
                    break
                except (OSError, ValueError, StopIteration):
                    time.sleep(.1)
            else:
                raise RuntimeError('Research worker unavailable')
            cdp = CDP(worker['webSocketDebuggerUrl'])
            result['probe'] = cdp.evaluate('''(async()=>{
              const pattern='https://zh.wiktionary.org/*'; let sent=0;
              const allowed=await chrome.permissions.contains({origins:[pattern]});
              if(!allowed) throw Error('Research pregrant missing');
              const url='https://zh.wiktionary.org/w/api.php?'+new URLSearchParams({
                action:'parse',page:'book',prop:'text|revid',format:'json',formatversion:'2',
                variant:'zh-hans',disableeditsection:'1'});
              sent++;
              const r=await fetch(url,{credentials:'omit',headers:{'Api-User-Agent':
                'TenshoResearch/0.1 (https://github.com/YoukouTenhouin/Tensho)'},
                signal:AbortSignal.timeout(15000)});
              const body=await r.text();
              if(new TextEncoder().encode(body).length>1048576)throw Error('Oversized');
              const payload=JSON.parse(body);
              const other=await chrome.permissions.contains({origins:['https://en.wiktionary.org/*']});
              return {allowed,status:r.status,revid:payload.parse?.revid,
                simplified:payload.parse?.text.includes('预订'),otherOriginGranted:other,sent};
            })()''')
        result['browser'] = subprocess.check_output(['microsoft-edge', '--version'], text=True).strip()
        p = result['probe']
        result['passed'] = p['status'] == 200 and p['simplified'] and not p['otherOriginGranted'] and p['sent'] == 1
    except Exception as error:
        result.update(passed=False, error=str(error))
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
(ROOT / 'edge-access-results.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
raise SystemExit(0 if result['passed'] else 1)
