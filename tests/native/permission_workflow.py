"""Interactive native UI acceptance against the controlled reading-test build.

Run after npm run build:controlled: python3 tests/native/permission_workflow.py --output /tmp/tensho-access
The runner pauses for screen coordinates only after saving each native menu or
permission prompt. Inspect that image before supplying X Y on stdin. It runs on
an isolated Xvfb display, never the user's browser profile or desktop.
Requires Edge, Xvfb, ImageMagick import, websocket-client, libX11 and libXtst.
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


def run(output, idle=False):
    output.mkdir(parents=True, exist_ok=True)
    repo = Path(__file__).resolve().parents[2]
    evidence = {'browser': version(['microsoft-edge', '--version']),
                'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'mode': 'isolated Xvfb / native XTest commands and inspected native prompts',
                'unmodified_production_build': False, 'controlled_analysis': True, 'checks': {}}
    checks = evidence['checks']
    with tempfile.TemporaryDirectory(prefix='tensho-access-') as temp:
        root = Path(temp)
        (root/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Access fixture</title><style>body{font:24px serif;padding:30px}input{font-size:24px}</style><p id="word" tabindex="0">puella</p><input id="editable" value="puellae">')
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=root))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f'http://127.0.0.1:{server.server_port}'; url = origin + '/index.html'
        (root/'frame.html').write_text('<!doctype html><style>body{font:24px serif}</style><p>agricola</p>')
        frame_server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=root))
        threading.Thread(target=frame_server.serve_forever, daemon=True).start()
        frame_origin=f'http://127.0.0.1:{frame_server.server_port}'

        browser = xvfb = None
        connections = []
        try:
            with (output/'browser.log').open('w') as log:
                reader, writer = os.pipe()
                xvfb = subprocess.Popen(['Xvfb','-displayfd',str(writer),'-screen','0','1400x1000x24','-nolisten','tcp'],pass_fds=(writer,),stdout=log,stderr=log)
                os.close(writer)
                if not select.select([reader],[],[],10)[0]: raise RuntimeError('No Xvfb display')
                display = ':' + os.read(reader,50).decode().strip(); os.close(reader)
                env = {**os.environ, 'DISPLAY': display}; env.pop('WAYLAND_DISPLAY', None)
                def launch():
                    return subprocess.Popen(['microsoft-edge','--ozone-platform=x11',f'--user-data-dir={root}/profile',
                        '--no-first-run','--no-default-browser-check',f'--disable-extensions-except={repo}/dist-controlled',f'--load-extension={repo}/dist-controlled',
                        '--remote-debugging-port=0','--window-size=1300,900','--window-position=0,0',url],env=env,stdout=log,stderr=log)
                browser = launch()
                port_file = root/'profile/DevToolsActivePort'; wait_for(port_file.exists)
                port = int(port_file.read_text().splitlines()[0])
                def targets():
                    with urllib.request.urlopen(f'http://localhost:{port}/json/list',timeout=2) as response: return json.load(response)
                def target(suffix): return next((t for t in targets() if t['url'].endswith(suffix)),None)
                def connect(item):
                    c=CDP(item['webSocketDebuggerUrl']);connections.append(c);return c
                wait_for(lambda:target('/worker.js'))
                reading=connect(wait_for(lambda:target('/index.html')))
                # The documented unpacked installation requires Developer mode;
                # command-line loading alone can be disabled by Edge on restart.
                reading.call('Page.navigate',url='edge://extensions')
                switch="(()=>{const walk=n=>[...n.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?walk(e.shadowRoot):[])]);const e=walk(document).find(e=>e.id==='dev-switch'&&e.getBoundingClientRect().width);return e?{...e.getBoundingClientRect().toJSON(),checked:e.getAttribute('checked')}:null})()"
                rect=wait_for(lambda:reading.evaluate(switch))
                if rect['checked']!='true':
                    for kind in ['mousePressed','mouseReleased']:
                        reading.call('Input.dispatchMouseEvent',type=kind,x=rect['x']+rect['width']/2,y=rect['y']+rect['height']/2,button='left',clickCount=1)
                wait_for(lambda:reading.evaluate(switch)['checked']=='true')
                checks['native_developer_mode_installation']=True
                reading.call('Page.navigate',url=url)
                wait_for(lambda:reading.evaluate("!!document.querySelector('#word')"))
                reading.call('Page.bringToFront')
                reading.evaluate("(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('#word'));getSelection().removeAllRanges();getSelection().addRange(r)})()")
                key(display,'Alt_L','Shift_L','l')
                panel=connect(wait_for(lambda:target('/panel.html')))
                wait_for(lambda:panel.evaluate("document.querySelector('#target')?.textContent==='puella' && document.querySelector('#status').textContent==='Controlled development response'"))
                checks['native_lookup_shortcut_with_temporary_access']=True
                checks['keyboard_lookup_focuses_results']=panel.evaluate("document.hasFocus() && document.activeElement.id==='results'")
                checks['temporary_lookup_does_not_grant_site']=panel.evaluate('chrome.permissions.getAll().then(p=>p.origins.length===0)')
                snapshot="(async()=>{const w=await chrome.windows.getCurrent();return chrome.runtime.sendMessage({type:'snapshot',windowId:w.id})})()"
                before=panel.evaluate(snapshot)['state']['generation']
                reading.call('Page.bringToFront');key(display,'Alt_L','Shift_L','k')
                wait_for(lambda:target('/panel.html') is None)
                key(display,'Alt_L','Shift_L','k')
                panel=connect(wait_for(lambda:target('/panel.html')))
                wait_for(lambda:panel.evaluate("document.hasFocus() && document.activeElement.id==='results'"))
                checks['native_focus_shortcut_does_not_lookup']=panel.evaluate(snapshot)['state']['generation']==before
                checks['native_focus_shortcut_focuses_results']=panel.evaluate("document.hasFocus() && document.activeElement.id==='results'")
                if idle:
                    print('Waiting 35 seconds for native worker idle shutdown',flush=True)
                    time.sleep(35)
                    evidence['worker_present_after_idle']=target('/worker.js') is not None
                # Explicit context-menu lookup in an editable field uses browser-supplied text.
                reading.call('Page.bringToFront')
                reading.evaluate("const i=document.querySelector('#editable');i.focus();i.select()")
                rect=reading.evaluate("document.querySelector('#editable').getBoundingClientRect().toJSON()")
                for kind in ['mousePressed','mouseReleased']:
                    reading.call('Input.dispatchMouseEvent',type=kind,x=rect['x']+35,y=rect['y']+15,button='right',clickCount=1)
                def inspected_click(name, instruction):
                    path=output/(name+'.png');time.sleep(.5)
                    subprocess.run(['import','-display',display,'-window','root',str(path)],check=True)
                    print(f'{instruction}: inspect {path}, then enter X Y',flush=True)
                    a,b=map(int,input().split());click(display,a,b)
                inspected_click('editable-context-menu','Select Look up selection with Tensho')
                time.sleep(.5)
                evidence['editable_context_snapshot']=panel.evaluate(snapshot)
                evidence['editable_context_ui']=panel.evaluate("document.querySelector('#target').textContent")
                (output/'editable-context-result.json').write_text(json.dumps(evidence,indent=2)+'\n')
                wait_for(lambda:panel.evaluate("document.querySelector('#target').textContent==='puellae'"))
                checks['native_context_menu_editable_lookup']=True
                # Browser-supplied frame selection works without a DOM host grant.
                reading.evaluate("(()=>{const f=document.createElement('iframe');f.id='ungranted';f.src="+json.dumps(frame_origin+'/frame.html')+";f.style.cssText='display:block;width:400px;height:100px';document.body.append(f)})()")
                wait_for(lambda:len(reading.call('Page.getFrameTree')['frameTree'].get('childFrames',[]))==1)
                time.sleep(.2)
                rect=reading.evaluate("document.querySelector('#ungranted').getBoundingClientRect().toJSON()")
                for count in [1,2]:
                    for kind in ['mousePressed','mouseReleased']:
                        reading.call('Input.dispatchMouseEvent',type=kind,x=rect['x']+35,y=rect['y']+40,button='left',clickCount=count)
                # Edge's sidebar contributes to outerWidth-innerWidth, not the left inset.
                offset=reading.evaluate('({x:screenX+4,y:screenY+outerHeight-innerHeight,scale:devicePixelRatio})')
                click(display,int((offset['x']+rect['x']+35)*offset['scale']),int((offset['y']+rect['y']+40)*offset['scale']),button=3)
                inspected_click('frame-context-menu','Select Look up selection with Tensho in the ungranted frame')
                time.sleep(.5)
                evidence['frame_context_snapshot']=panel.evaluate(snapshot)
                (output/'frame-context-result.json').write_text(json.dumps(evidence,indent=2)+'\n')
                wait_for(lambda:panel.evaluate("document.querySelector('#target').textContent==='agricola'"))
                frame_state=panel.evaluate(snapshot)['state']
                checks['native_frame_context_menu_routes_source']=frame_state['identity']['frameId']!=0
                checks['frame_context_menu_does_not_grant_site']=panel.evaluate('chrome.permissions.getAll().then(p=>p.origins.length===0)')
                checks['frame_context_menu_does_not_imply_dom_access']=panel.evaluate('(async()=>{try{await chrome.scripting.executeScript({target:{tabId:'+str(frame_state['identity']['tabId'])+',frameIds:['+str(frame_state['identity']['frameId'])+']},func:()=>document.title});return false}catch{return true}})()')

                panel.evaluate("document.querySelector('details').open=true")
                panel.call('Runtime.evaluate',expression="document.querySelector('#enable-current').click()",userGesture=True)
                inspected_click('deny-prompt','Deny the native permission request')
                wait_for(lambda:panel.evaluate("document.querySelector('#feedback').textContent.includes('denied')"))
                checks['native_denial_keeps_origin_ungranted']=panel.evaluate('chrome.permissions.getAll().then(p=>p.origins.length===0)')
                checks['native_denial_keeps_automatic_lookup_disabled']=not panel.evaluate('chrome.storage.local.get("enabledOrigins").then(s=>s.enabledOrigins||[])')
                panel.call('Runtime.evaluate',expression="document.querySelector('#enable-current').click()",userGesture=True)
                inspected_click('allow-prompt','Allow the native permission request')
                wait_for(lambda:origin in panel.evaluate('chrome.storage.local.get("enabledOrigins").then(s=>s.enabledOrigins||[])'))
                evidence['granted']=panel.evaluate('chrome.permissions.getAll()')
                checks['native_grant_is_exact_origin']=evidence['granted']['origins']==[origin+'/*']
                (output/'results-before-restart.json').write_text(json.dumps(evidence,indent=2)+'\n')
                # Full browser process restart, reusing only this disposable profile.
                for c in connections:c.ws.close()
                connections.clear();
                close_target=CDP(target('/index.html')['webSocketDebuggerUrl']);close_target.call('Browser.close');close_target.ws.close();browser.wait(timeout=10);port_file.unlink(missing_ok=True)
                browser=launch();wait_for(port_file.exists);port=int(port_file.read_text().splitlines()[0])
                reading=connect(wait_for(lambda:target('/index.html')))
                wait_for(lambda:reading.evaluate("!!document.querySelector('#word')"))
                time.sleep(.3)
                reading.call('Page.bringToFront')
                rect=reading.evaluate("document.querySelector('#word').getBoundingClientRect().toJSON()")
                for count in [1,2]:
                    for kind in ['mousePressed','mouseReleased']:reading.call('Input.dispatchMouseEvent',type=kind,x=rect['x']+20,y=rect['y']+12,button='left',clickCount=count)
                panel=connect(wait_for(lambda:target('/panel.html')))
                wait_for(lambda:panel.evaluate("document.querySelector('#target')?.textContent==='puella'"))
                checks['site_enablement_survives_browser_restart']=origin in panel.evaluate('chrome.storage.local.get("enabledOrigins").then(s=>s.enabledOrigins||[])')
                checks['automatic_lookup_after_browser_restart']=True
                before=panel.evaluate(snapshot)['state']['generation']
                panel.evaluate('chrome.permissions.remove({origins:['+json.dumps(origin+'/*')+']})')
                wait_for(lambda:panel.evaluate('chrome.scripting.getRegisteredContentScripts().then(s=>s.length===0)'))
                for count in [1,2]:
                    for kind in ['mousePressed','mouseReleased']:reading.call('Input.dispatchMouseEvent',type=kind,x=rect['x']+20,y=rect['y']+12,button='left',clickCount=count)
                time.sleep(.2)
                checks['native_revocation_stops_automatic_lookup']=panel.evaluate(snapshot)['state']['generation']==before
                checks['native_revocation_preserves_result']=panel.evaluate("document.querySelector('#target').textContent==='puella'")
                # Focus results with the native command, then use native Escape.
                key(display,'Alt_L','Shift_L','k')
                wait_for(lambda:target('/panel.html') is None)
                key(display,'Alt_L','Shift_L','k')
                panel=connect(wait_for(lambda:target('/panel.html')))
                wait_for(lambda:panel.evaluate("document.hasFocus() && document.activeElement.id==='results'"))
                key(display,'Escape')
                wait_for(lambda:target('/panel.html') is None)
                checks['native_escape_closes_and_restores_focus']=reading.evaluate('document.hasFocus()')
                evidence['passed']=all(checks.values())
                (output/'results.json').write_text(json.dumps(evidence,indent=2)+'\n')
                print(json.dumps(evidence,indent=2),flush=True)
                return evidence['passed']
        finally:
            for c in connections:c.ws.close()
            for process in [browser,xvfb]:
                if process:
                    process.terminate()
                    try:process.wait(timeout=8)
                    except subprocess.TimeoutExpired:process.kill();process.wait()
            server.shutdown();server.server_close()
            frame_server.shutdown();frame_server.server_close()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);parser.add_argument('--idle',action='store_true')
    args=parser.parse_args()
    raise SystemExit(0 if run(args.output,args.idle) else 1)
