"""One bounded actual Edge MV3 request; no retries or raw unpermitted fetches.

Default is offline: validate the retained result. --live --output PATH is an
explicit single research request, not a quota or permission to replay it.
Requires microsoft-edge and Python websocket-client; uses a disposable profile.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tests/native'))
from permission_scope import CDP

HOST = 'https://www.sanskrit-lexicon.uni-koeln.de/*'
URL = 'https://www.sanskrit-lexicon.uni-koeln.de/scans/awork/apidev/getword_xml.php?dict=mw&key=agni&input=slp1&output=roman'
EXPRESSION = r'''(async()=>{
  const url=URL, granted=await chrome.permissions.contains({origins:[HOST]});
  if(!granted)return {granted,fetches:0,state:'access-not-granted'};
  const start=new Date().toISOString();
  try {
    const r=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
    const reader=r.body.getReader();let size=0;const chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>1048576){await reader.cancel();throw Error('response exceeds 1 MiB');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    let validation={valid:false};try{const p=JSON.parse(body);validation={valid:r.ok&&p.status===200&&p.dict==='mw'&&p.key==='agni'&&Array.isArray(p.xml)&&p.xml.length>0&&Array.isArray(p.html)&&p.xml.length===p.html.length,keys:Object.keys(p),status:p.status,xmlCount:p.xml?.length,htmlCount:p.html?.length};}catch{}
    return {url,granted,fetches:1,start,status:r.status,headers:Object.fromEntries(r.headers),bytes:size,sha256,validation,body};
  }catch(e){return {url,granted,fetches:1,start,error:String(e)};}
})()'''.replace('URL', json.dumps(URL)).replace('HOST', json.dumps(HOST))


def run(output):
    if output.exists():
        raise RuntimeError('Refusing to overwrite evidence')
    evidence = {'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'browser': subprocess.check_output(['microsoft-edge', '--version'], text=True).strip(),
                'mode': 'headless=new actual Edge MV3 service worker; disposable profile',
                'limits': {'requests': 1, 'timeoutMs': 15000, 'responseBytes': 1048576,
                           'retries': 0, 'credentials': 'omit', 'redirect': 'error'},
                'provider_quota': None}
    with tempfile.TemporaryDirectory(prefix='tensho-issue19-edge-') as temporary:
        root = Path(temporary)
        extension = root / 'extension'
        extension.mkdir()
        manifest = {'manifest_version': 3, 'name': 'Tensho issue 19 research', 'version': '0.0.1',
                    'host_permissions': [HOST], 'background': {'service_worker': 'worker.js'}}
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        (extension / 'worker.js').write_text('chrome.runtime.onInstalled.addListener(()=>{});')
        evidence['manifest'] = manifest
        worker = manager = browser = None
        try:
            with (root / 'browser.log').open('w') as log:
                browser = subprocess.Popen(['microsoft-edge', '--headless=new', '--no-first-run',
                    '--no-default-browser-check', '--disable-background-networking',
                    f'--user-data-dir={root}/profile', f'--disable-extensions-except={extension}',
                    f'--load-extension={extension}', '--remote-debugging-port=0', 'about:blank'], stdout=log, stderr=log)
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    try:
                        port = int((root / 'profile/DevToolsActivePort').read_text().splitlines()[0])
                        base = f'http://localhost:{port}'
                        with urllib.request.urlopen(base + '/json/list', timeout=2) as response:
                            target = next(t for t in json.load(response) if t['url'].endswith('/worker.js'))
                        break
                    except (OSError, StopIteration):
                        time.sleep(0.1)
                else:
                    raise RuntimeError('Edge worker did not start: ' + (root / 'browser.log').read_text()[-2000:])
                worker = CDP(target['webSocketDebuggerUrl'])
                evidence['userAgent'] = worker.evaluate('navigator.userAgent')
                evidence['granted'] = worker.evaluate(EXPRESSION)
                request = urllib.request.Request(base + '/json/new?edge://extensions/', method='PUT')
                with urllib.request.urlopen(request, timeout=2) as response:
                    page = json.load(response)
                manager = CDP(page['webSocketDebuggerUrl'])
                manager.evaluate('chrome.developerPrivate.updateExtensionConfiguration(' + json.dumps({
                    'extensionId': target['url'].split('/')[2], 'hostAccess': 'ON_CLICK'}) + ')')
                if worker.evaluate('chrome.permissions.contains({origins:[' + json.dumps(HOST) + ']})'):
                    raise RuntimeError('Revocation failed; refusing a second request')
                evidence['revoked'] = worker.evaluate(EXPRESSION)
        finally:
            for client in (worker, manager):
                if client:
                    client.ws.close()
            if browser:
                browser.terminate()
                try:
                    browser.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    browser.kill()
                    browser.wait()
    output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
    return evidence


def validate(path):
    data = json.loads(path.read_text())
    assert data['granted']['granted'] and data['granted']['fetches'] == 1
    assert data['revoked'] == {'granted': False, 'fetches': 0, 'state': 'access-not-granted'}
    assert data['limits']['retries'] == 0 and data['provider_quota'] is None
    result = data['granted']
    assert result['url'] == URL
    if 'body' in result:
        body = result['body'].encode('utf-8')
        assert len(body) == result['bytes']
        assert hashlib.sha256(body).hexdigest() == result['sha256']
    return {'evidence_valid': True, 'access_passed': data['granted'].get('validation', {}).get('valid', False)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--output', type=Path, default=Path(__file__).with_name('edge-access-results.json'))
    args = parser.parse_args()
    if args.live:
        run(args.output)
    print(json.dumps(validate(args.output), indent=2))
