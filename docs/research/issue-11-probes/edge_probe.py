"""Actual Edge MV3 fetch probes for issue #11; fresh disposable profiles.

Run: python3 edge_probe.py /tmp/sanskrit-urls.json > /tmp/sanskrit-edge.json
Input is a JSON array of exact HTTPS request URLs. Requires actual Microsoft
Edge and websocket-client. Reuses the issue #10 browser/permission harness.
No challenge solving, retries, user profile access, or provider code execution.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'issue-10-probes'))
import edge_probe as harness


def expression(guard):
    return r'''(async()=>{
      const results=[]; let fetches=0;
      for(const url of URLS){
        const origin=new URL(url).origin+'/*';
        const granted=await chrome.permissions.contains({origins:[origin]});
        if(GUARD && !granted){results.push({url,granted,state:'access-not-granted'});continue;}
        fetches++;
        try{
          const r=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(15000)});
          const body=await r.text();
          const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
          const sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
          let jsonShape=null;
          try{const data=JSON.parse(body);jsonShape=Array.isArray(data)?{type:'array',length:data.length}:{type:typeof data,keys:Object.keys(data)}}catch{}
          results.push({url,finalUrl:r.url,granted,status:r.status,
            contentType:r.headers.get('content-type'),characters:body.length,sha256,jsonShape,
            anubis:body.includes('Anubis'),excerpt:body.slice(0,500)});
        }catch(e){results.push({url,granted,error:String(e)})}
      }
      return {permissions:await chrome.permissions.getAll(),fetches,results};
    })()'''.replace('URLS', json.dumps(harness.URLS)).replace('GUARD', json.dumps(guard))


if __name__ == '__main__':
    urls=json.loads(Path(sys.argv[1]).read_text())
    assert urls and all(urlsplit(u).scheme=='https' and not urlsplit(u).username for u in urls)
    binary=shutil.which('microsoft-edge') or shutil.which('microsoft-edge-stable')
    if not binary:
        raise SystemExit('Actual Microsoft Edge required')
    harness.URLS=urls
    harness.HOSTS=list(dict.fromkeys('https://'+urlsplit(u).netloc+'/*' for u in urls))
    harness.fetch_expression=expression
    with tempfile.TemporaryDirectory(prefix='tensho-issue11-edge-') as temporary:
        root=Path(temporary)
        result={'observed_at_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
                'browser_version':subprocess.check_output([binary,'--version'],text=True).strip(),
                'mode':'headless=new; disposable actual Edge MV3 service worker',
                'granted_then_revoked':harness.run_variant(binary,root/'required',False,9251),
                'optional_never_granted':harness.run_variant(binary,root/'optional',True,9252)}
        print(json.dumps(result,ensure_ascii=False,indent=2))
