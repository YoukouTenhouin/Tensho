"""Private-session Orca probe; invoke through orca_workflow.py and silent_speech.py.

CDP drives controlled provider scenarios; real Orca processes native AT-SPI events.
Speech capture observes Orca's speech API, not physical audibility or pronunciation.
"""
import os,sys,json,time,tempfile,subprocess,urllib.request,shutil,functools,http.server,threading
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from permission_scope import CDP,QuietHandler
from reading_workflow import wait_for
import gi
gi.require_version('Gio','2.0')
from gi.repository import Gio,GLib
i18n=os.environ.get('TENSHO_ORCA_I18N')=='1'
out=Path(os.environ['TENSHO_ORCA_OUTPUT']);out.mkdir(parents=True,exist_ok=True)
bus=Gio.bus_get_sync(Gio.BusType.SESSION,None)
def status_get(k):return bus.call_sync('org.a11y.Bus','/org/a11y/bus','org.freedesktop.DBus.Properties','Get',GLib.Variant('(ss)',('org.a11y.Status',k)),None,Gio.DBusCallFlags.NONE,2000,None).unpack()[0]
def status_set(k,v):bus.call_sync('org.a11y.Bus','/org/a11y/bus','org.freedesktop.DBus.Properties','Set',GLib.Variant('(ssv)',('org.a11y.Status',k,GLib.Variant('b',v))),None,Gio.DBusCallFlags.NONE,2000,None)
initial={k:status_get(k) for k in ['IsEnabled','ScreenReaderEnabled']}
r={'interface_language':'zh-Hans' if i18n else 'en','observed_at_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'mode':'isolated Xvfb X11 and private accessibility/session bus on openSUSE; not a shared KDE run','initial_accessibility':initial,'checks':{},'actions':[]}
connections=[];browser=orca=server=registry=None
try:
 if subprocess.run(['pgrep','-x','orca'],stdout=subprocess.DEVNULL).returncode==0:raise RuntimeError('Existing Orca; refusing to replace it')
 status_set('IsEnabled',True)
 status_set('ScreenReaderEnabled',True)
 registry=subprocess.Popen(['/usr/libexec/at-spi2/at-spi2-registryd'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 time.sleep(.5)
 if registry.poll() is not None:raise RuntimeError('Private registry failed to start')
 r['explicit_accessibility_bus']=True
 if True:
  d=tempfile.mkdtemp(prefix='tensho-27-orca-')
  root=Path(d);(root/'profile/Default').mkdir(parents=True)
  (root/'profile/Default/Preferences').write_text(json.dumps({'extensions':{'ui':{'developer_mode':True}}}))
  (root/'index.html').write_text('<title>Tensho Orca acceptance</title><p id="reading-word" tabindex="0" style="font-size:24px">malum puella</p>')
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=root))
  threading.Thread(target=server.serve_forever,daemon=True).start()
  origin=f'http://127.0.0.1:{server.server_port}';url=origin+'/index.html'
  extension=root/'extension';shutil.copytree(Path(__file__).resolve().parents[2]/'dist-recovery',extension)
  manifest=json.loads((extension/'manifest.json').read_text());manifest['host_permissions']=[origin+'/*'];(extension/'manifest.json').write_text(json.dumps(manifest))
  browserlog=(out/'browser.log').open('w')
  browser=subprocess.Popen(['microsoft-edge','--ozone-platform=x11','--force-renderer-accessibility=complete',f'--user-data-dir={root}/profile','--no-first-run','--no-default-browser-check','--password-store=basic',f'--disable-extensions-except={extension}',f'--load-extension={extension}','--remote-debugging-port=0','--window-size=1300,900','--window-position=0,0',url],stdout=browserlog,stderr=browserlog)
  pf=root/'profile/DevToolsActivePort';wait_for(pf.exists);port=int(pf.read_text().splitlines()[0])
  def targets():
   with urllib.request.urlopen(f'http://localhost:{port}/json/list') as f:return json.load(f)
  def target(s):return next((t for t in targets() if t['url'].endswith(s)),None)
  def connect(t):
   c=CDP(t['webSocketDebuggerUrl']);connections.append(c);return c
  worker=connect(wait_for(lambda:target('/worker.js')))
  wait_for(lambda:worker.evaluate("typeof chrome !== 'undefined' && !!chrome.runtime?.id"))
  reading=connect(wait_for(lambda:target('/index.html')))
  eid=worker.evaluate('chrome.runtime.id')
  reading.call('Page.navigate',url=f'chrome-extension://{eid}/panel.html')
  wait_for(lambda:reading.evaluate("typeof chrome !== 'undefined' && !!chrome.storage"))
  reading.evaluate('chrome.storage.local.set({enabledOrigins:['+json.dumps(origin)+']})')
  wait_for(lambda:reading.evaluate('chrome.scripting.getRegisteredContentScripts().then(s=>s.length===1)'))
  reading.call('Page.navigate',url=url)
  wait_for(lambda:reading.evaluate("!!document.querySelector('#reading-word')"));time.sleep(.3)
  rect=reading.evaluate("document.querySelector('#reading-word').getBoundingClientRect().toJSON()")
  for count in [1,2]:
   for kind in ['mousePressed','mouseReleased']:reading.call('Input.dispatchMouseEvent',type=kind,x=rect['x']+20,y=rect['y']+12,button='left',clickCount=count)
  panel=connect(wait_for(lambda:target('/panel.html')))
  wait_for(lambda:panel.evaluate("document.querySelector('#active-settings')?.textContent.includes(' · ')"))
  data=root/'data';(data/'orca').mkdir(parents=True)
  speech=out/'speech.jsonl';speech.write_text('');(out/'runtime.jsonl').write_text('');(out/'live-events.jsonl').write_text('');(out/'raw-events.jsonl').write_text('')
  (data/'orca/orca-customizations.py').write_text('''import json
from orca import speech, script_manager, speech_manager, live_region_presenter, event_manager
from orca.ax_utilities import AXUtilities
import gi
gi.require_version('Atspi','2.0')
from gi.repository import GLib, Atspi
def capture(text):
 try:
  app=script_manager.get_manager().get_active_script_app()
  if app and app.get_process_id()=='''+str(browser.pid)+''':
   with open('''+repr(str(speech))+''','a') as f:f.write(json.dumps({'text':text})+'\\n')
 except Exception:pass
def raw_event(event,*args):
 try:
  app=event.source.get_application()
  if app and app.get_process_id()=='''+str(browser.pid)+''':
   with open('''+repr(str(out/'raw-events.jsonl'))+''','a') as f:f.write(json.dumps({'type':event.type,'role':event.source.get_role_name(),'reason':str(AXUtilities.get_text_event_reason(event)),'attributes':event.source.get_attributes(),'text':str(event.any_data)})+'\\n')
 except Exception:pass
listener=Atspi.EventListener.new(raw_event)
listener.register('object:text-changed:insert')
presenter=live_region_presenter.get_presenter()
original_presentable=presenter.is_presentable_live_region_event
def observed_presentable(script,event):
 result=original_presentable(script,event)
 try:
  if script.app and script.app.get_process_id()=='''+str(browser.pid)+''':
   this_doc=script.utilities.get_top_level_document_for_object(event.source)
   active_doc=script.utilities.active_document()
   with open('''+repr(str(out/'live-events.jsonl'))+''','a') as f:f.write(json.dumps({'type':event.type,'presentable':result,'different_active_document':bool(this_doc and active_doc and this_doc!=active_doc),'text':str(event.any_data)})+'\\n')
 except Exception:pass
 return result
presenter.is_presentable_live_region_event=observed_presentable
manager=event_manager.get_manager()
original_filter=manager._ignore_by_spam_filter
def observed_filter(event):
 result=original_filter(event)
 try:
  if event.source.get_application().get_process_id()=='''+str(browser.pid)+''' and event.type.startswith('object:text-changed:insert'):
   with open('''+repr(str(out/'live-events.jsonl'))+''','a') as f:f.write(json.dumps({'spam_filter':result,'text':str(event.any_data)})+'\\n')
 except Exception:pass
 return result
manager._ignore_by_spam_filter=observed_filter
original_speak=speech._speak
def observed_speak(text,acss):
 capture(text)
 return original_speak(text,acss)
speech._speak=observed_speak
def stats():
 app=script_manager.get_manager().get_active_script_app()
 with open('''+repr(str(out/'runtime.jsonl'))+''','a') as f:f.write(json.dumps({'speech_server':speech_manager.get_manager().get_server() is not None,'active_test_app':bool(app and app.get_process_id()=='''+str(browser.pid)+'''),'active_script':app is not None,'script_module':type(script_manager.get_manager().get_active_script()).__module__ if app and app.get_process_id()=='''+str(browser.pid)+''' else None,'muted':speech.get_mute_speech()})+'\\n')
 return True
GLib.timeout_add_seconds(1,stats)
def positive_control():
 speech.speak('Tensho speech recorder positive control')
 return False
GLib.timeout_add_seconds(3,positive_control)
''')
  base=os.environ['TENSHO_ORCA_RUNTIME']
  env={**os.environ,'PYTHONPATH':base+'/lib/python3.13/site-packages:'+base+'/lib64/python3.13/site-packages','LD_LIBRARY_PATH':base+'/lib64','GSETTINGS_BACKEND':'memory','GSETTINGS_SCHEMA_DIR':base+'/share/glib-2.0/schemas','XDG_DATA_HOME':str(data),'XDG_CONFIG_HOME':str(root/'config')}
  orcalog=(out/'orca.log').open('w')
  orca=subprocess.Popen(['python3',base+'/bin/orca','--speech-system','speechdispatcherfactory'],env=env,stdout=orcalog,stderr=orcalog)
  wait_for(lambda:(out/'runtime.jsonl').stat().st_size>0 or orca.poll() is not None,seconds=30);r['orca_exit_after_start']=orca.poll()
  gi.require_version('Atspi','2.0')
  from gi.repository import Atspi
  desktop=Atspi.get_desktop(0)
  app=next((desktop.get_child_at_index(i) for i in range(desktop.get_child_count()) if desktop.get_child_at_index(i).get_process_id()==browser.pid),None)
  r['atspi_test_app_found']=app is not None
  accessible=[]
  def walk(node,depth=0):
   if depth>15 or len(accessible)>600:return
   accessible.append({'role':node.get_role_name(),'name':node.get_name(),'attributes':node.get_attributes()})
   for i in range(node.get_child_count()):
    child=node.get_child_at_index(i)
    if child:walk(child,depth+1)
  if app:walk(app)
  (out/'test-browser-atspi.json').write_text(json.dumps(accessible,indent=2))
  r['atspi_nodes']=len(accessible)
  r['atspi_manual_input_found']=any(n['name']==('单词或段落' if i18n else 'Word or passage') for n in accessible)
  if orca.poll() is not None:raise RuntimeError('Orca failed to start; see orca.log')
  # CDP drives the reading controls while Orca observes actual native accessibility events.
  # This is explicitly distinct from the separate keyboard-only acceptance run.
  panel.evaluate("document.querySelector('#word').focus();globalThis.testKey=null;document.addEventListener('keydown',e=>globalThis.testKey={key:e.key,trusted:e.isTrusted},{once:true})")
  time.sleep(1)
  def snap():return panel.evaluate("chrome.windows.getCurrent().then(w=>chrome.runtime.sendMessage({type:'snapshot',windowId:w.id}))")
  def submit(text):
   panel.evaluate('document.querySelector("#word").value='+json.dumps(text)+';document.querySelector("#lookup").requestSubmit()');r['actions'].append('manual '+text)
  def activate_test():
   wait_for(lambda: (lambda rows: bool(rows) and json.loads(rows[-1])['active_test_app'])((out/'runtime.jsonl').read_text().splitlines()),seconds=8)
  activate_test()
  def spoken(text):return any(text in json.loads(line)['text'] for line in speech.read_text().splitlines())
  submit('sessionpending');wait_for(lambda:snap().get('state',{}).get('status')=='complete');time.sleep(1)
  r['dictionary_focus']=panel.evaluate('({focus:document.hasFocus(),scroll:scrollY,status:document.querySelector("#dictionary-status").getBoundingClientRect().toJSON(),height:innerHeight})')
  panel.evaluate("document.querySelector('#dictionary-0').click()")
  wait_for(lambda:snap().get('dictionaries',{}).get('0',{}).get('resolution',{}).get('status')=='complete');wait_for(lambda:spoken('可能的词条' if i18n else 'possible entries'),seconds=8);r['checks']['dictionary_resolution_spoken']=True
  for entry in ['n1','n2']:
   panel.evaluate('document.querySelector("#article-0-'+entry+'").click()')
   wait_for(lambda:snap()['dictionaries']['0'].get('articles',{}).get(entry,{}).get('status')=='complete');wait_for(lambda:spoken(('词条 '+str(['n1','n2'].index(entry)+1)+'：d-first的词条已加载。') if i18n else ('entry '+str(['n1','n2'].index(entry)+1)+': Entry from d-first is ready.')),seconds=8);r['checks']['article_'+entry+'_spoken']=True
  r['actions'].append('resolve and read two articles')
  submit('malum puella');wait_for(lambda:snap().get('state',{}).get('passage') is not None)
  panel.evaluate("document.querySelector('#passage-word-1').focus();document.querySelector('#passage-word-1').click()")
  wait_for(lambda:snap().get('state',{}).get('status')=='complete');time.sleep(1);r['actions'].append('choose passage word')
  worker.evaluate("globalThis.__tenshoRecoveryScenario='analysis-exhausted'");submit('malum')
  wait_for(lambda:snap().get('state',{}).get('status')=='error');wait_for(lambda:spoken('连接失败。' if i18n else 'Connection failed.'),seconds=8);r['checks']['analysis_error_spoken']=True
  panel.evaluate("document.querySelector('#retry').focus()")
  worker.evaluate("globalThis.__tenshoRecoveryScenario=undefined");panel.evaluate("document.querySelector('#retry').click()")
  wait_for(lambda:snap().get('state',{}).get('status')=='complete');time.sleep(1);r['actions'].append('failure and explicit retry')
  panel.evaluate("document.querySelector('#open-settings').click()")
  options=connect(wait_for(lambda:target('/options.html')))
  wait_for(lambda:options.evaluate("!!document.querySelector('#provider-analysis-0')"))
  options.call('Page.bringToFront')
  options.evaluate("document.querySelector('#provider-analysis-0').focus()")
  time.sleep(.5)
  options.evaluate("document.querySelector('#provider-analysis-0').click()")
  wait_for(lambda:spoken('有未保存的更改' if i18n else 'Unsaved changes'),seconds=8);r['checks']['settings_draft_spoken']=True
  options.evaluate("document.querySelector('#lookup-settings').requestSubmit()")
  wait_for(lambda:spoken('设置已保存' if i18n else 'Settings saved'),seconds=8);r['checks']['settings_saved_spoken']=True
  reading.call('Page.bringToFront')
  panel.evaluate("document.querySelector('#status').textContent='Tensho sidebar polite status positive control'");time.sleep(3)
  panel.evaluate("document.querySelector('#feedback').textContent='Tensho sidebar alert positive control'");time.sleep(3)
  reading.evaluate("document.body.insertAdjacentHTML('beforeend','<p id=control-status role=status aria-live=polite></p>')")
  reading.call('Page.bringToFront')
  reading.evaluate("document.querySelector('#reading-word').focus()")
  time.sleep(1);reading.evaluate("document.querySelector('#control-status').textContent='Tensho ordinary page live status positive control'");time.sleep(3)
  r['speech_utterances']=len(speech.read_text().splitlines());r['orca_exit_after_workflow']=orca.poll()
  r['checks']['orca_remains_running']=orca.poll() is None
  r['checks']['test_browser_speech_observed']=r['speech_utterances']>0
  r['scope']='Controlled reading and settings sequence driven through CDP, with actual Orca speech API output and native AT-SPI events; not keyboard-only, physical audibility, or shared KDE acceptance'
  r['passed']=all(r['checks'].values())
except Exception as e:
 import traceback
 r['failure']=str(e);r['traceback']=traceback.format_exc()
finally:
 for p in [orca,browser,registry]:
  if p and p.poll() is None:
   p.terminate()
   try:p.wait(timeout=8)
   except subprocess.TimeoutExpired:p.kill();p.wait()
 for c in connections:
  try:c.ws.close()
  except:pass
 for k,v in initial.items():
  if status_get(k)!=v:status_set(k,v)
 r['restored_accessibility']={k:status_get(k) for k in initial}
 if server:server.shutdown();server.server_close()
 if 'd' in locals():shutil.rmtree(d,ignore_errors=True)
 (out/'results.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))

raise SystemExit(1 if 'failure' in r else 0)
