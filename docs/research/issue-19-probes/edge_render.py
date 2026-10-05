"""Offline extracted-record rendering in actual Edge; no dictionary requests.

Run with --output /tmp/issue19-render.json. Uses Python websocket-client and a
disposable headless Edge profile. This is research, not production UI code.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

from extract_articles import run as extract

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tests/native'))
from permission_scope import CDP

RENDER = r'''payload=>{
  const records=payload.cases.flatMap(c=>c.records);
  const allowedLink=raw=>{try{
    const u=new URL(raw);
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&
      u.hostname==='www.sanskrit-lexicon.uni-koeln.de'&&
      u.pathname==='/scans/awork/apidev/getword_xml.php'&&
      !u.hash&&u.searchParams.get('dict')==='mw'&&
      /^\d+(?:\.\d+)?$/.test(u.searchParams.get('lnum'))&&
      u.searchParams.get('input')==='slp1'&&u.searchParams.get('output')==='roman'&&
      [...u.searchParams.keys()].sort().join(',')==='dict,input,lnum,output';
  }catch{return false;}};
  const root=document.createElement('main');
  for(const record of records){
    const s=document.createElement('section');s.dataset.record=record.recordId;
    for(const value of record.paragraphs){const p=document.createElement('p');p.textContent=value;s.append(p);}
    const credit=document.createElement('footer');credit.textContent=payload.attribution;s.append(credit);
    if(allowedLink(record.sourceLink)){
      const a=document.createElement('a');a.href=record.sourceLink;a.textContent='Source record (article completeness unverified)';
      a.target='_blank';a.rel='noopener noreferrer';s.append(a);
    }
    root.append(s);
  }
  document.body.replaceChildren(root);
  const sections=[...root.querySelectorAll('section')];
  return {
    records:sections.length,
    exactParagraphs:sections.every((s,i)=>JSON.stringify([...s.querySelectorAll('p')].map(p=>p.textContent))===JSON.stringify(records[i].paragraphs)),
    credits:sections.every(s=>s.querySelector('footer').textContent===payload.attribution),
    safeLinks:sections.every((s,i)=>{const a=s.querySelector('a');return a&&a.href===records[i].sourceLink&&allowedLink(a.href)&&a.rel==='noopener noreferrer'&&a.target==='_blank';}),
    tags:[...new Set([...root.querySelectorAll('*')].map(e=>e.tagName))].sort(),
    activeAttributes:[...root.querySelectorAll('*')].flatMap(e=>[...e.attributes]).filter(a=>/^on/i.test(a.name)||['src','srcdoc','style'].includes(a.name)).length,
    rejectedLinks:['javascript:alert(1)','https://evil.example/','https://www.sanskrit-lexicon.uni-koeln.de@evil.example/','https://www.sanskrit-lexicon.uni-koeln.de/scans/awork/apidev/getword_xml.php?dict=mw&lnum=1&input=slp1&output=roman&callback=evil'].every(u=>!allowedLink(u))
  };
}'''


def run(output):
    payload = extract()
    evidence = {'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'browser': subprocess.check_output(['microsoft-edge', '--version'], text=True).strip(),
                'mode': 'headless actual Edge, offline research text renderer',
                'live_provider_requests': 0, 'production_implementation': False}
    browser = cdp = None
    with tempfile.TemporaryDirectory(prefix='tensho-issue19-render-') as temporary:
        root = Path(temporary)
        try:
            with (root/'browser.log').open('w') as log:
                browser = subprocess.Popen(['microsoft-edge', '--headless=new', '--no-first-run',
                    '--no-default-browser-check', '--disable-background-networking', '--disable-extensions',
                    f'--user-data-dir={root}/profile', '--remote-debugging-port=0', 'about:blank'], stdout=log, stderr=log)
                deadline = time.monotonic()+20
                while time.monotonic()<deadline:
                    try:
                        port = int((root/'profile/DevToolsActivePort').read_text().splitlines()[0])
                        with urllib.request.urlopen(f'http://localhost:{port}/json/list', timeout=2) as response:
                            target = next(t for t in json.load(response) if t['type']=='page')
                        break
                    except (OSError, StopIteration): time.sleep(.1)
                else: raise RuntimeError('Edge page did not start')
                cdp = CDP(target['webSocketDebuggerUrl'])
                cdp.call('Network.enable')
                cdp.call('Network.setBlockedURLs', urls=['http://*','https://*'])
                control = cdp.evaluate("(()=>{window.providerActive=0;const b=document.createElement('button');b.setAttribute('onclick','window.providerActive++');document.body.append(b);b.click();return window.providerActive===1})()")
                cdp.evaluate('window.providerActive=0')
                observed = cdp.evaluate('('+RENDER+')('+json.dumps(payload)+')')
                evidence['render'] = observed
                checks = {'all_records_rendered':observed['records']==36,
                          'all_extracted_paragraphs_exact':observed['exactParagraphs'],
                          'attribution_retained':observed['credits'],
                          'safe_source_links_only':observed['safeLinks'] and observed['rejectedLinks'],
                          'owned_elements_only':observed['tags']==['A','FOOTER','P','SECTION'] and observed['activeAttributes']==0,
                          'active_content_positive_control':control,
                          'no_provider_code_execution':cdp.evaluate('window.providerActive')==0}
                hostile = json.loads(json.dumps(payload))
                hostile['cases'] = [{'records':[dict(payload['cases'][0]['records'][0], paragraphs=['<img src=x onerror="window.providerActive++"> & <script>window.providerActive++</script>'])]}]
                attack = cdp.evaluate('('+RENDER+')('+json.dumps(hostile)+')')
                checks['markup_in_text_remains_literal'] = attack['exactParagraphs'] and attack['tags']==['A','FOOTER','P','SECTION'] and cdp.evaluate('window.providerActive')==0
                evidence.update(checks=checks, passed=all(checks.values()))
        finally:
            if cdp: cdp.ws.close()
            if browser:
                browser.terminate()
                try: browser.wait(timeout=8)
                except subprocess.TimeoutExpired: browser.kill(); browser.wait()
    output.write_text(json.dumps(evidence, indent=2)+'\n')
    return evidence


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    result=run(parser.parse_args().output)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['passed'] else 1)
