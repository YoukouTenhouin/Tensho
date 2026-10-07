"""Exercise quick preferences, the settings tab, concurrent drafts and profile restart in isolated native Edge.

Run after npm run build:controlled. Only analysis responses are controlled;
configuration storage, routing, sidebar UI and browser lifecycle are production.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import time
import urllib.request

from native_input import key
from permission_scope import CDP
from reading_workflow import wait_for, version


def run(output):
    output.mkdir(parents=True, exist_ok=True)
    repo = Path(__file__).resolve().parents[2]
    evidence = {'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'browser': version(['microsoft-edge', '--version']), 'mode': 'isolated Xvfb / X11',
                'controlled_analysis': True, 'production_configuration_and_routing': True, 'checks': {}}
    checks = evidence['checks']
    connections = []
    browser = xvfb = None
    with tempfile.TemporaryDirectory(prefix='tensho-settings-') as temporary:
        root = Path(temporary)
        (root / 'profile/Default').mkdir(parents=True)
        (root / 'profile/Default/Preferences').write_text(json.dumps({'extensions': {'ui': {'developer_mode': True}}}))
        try:
            with (output / 'browser.log').open('w') as log:
                reader, writer = os.pipe()
                xvfb = subprocess.Popen(['Xvfb', '-displayfd', str(writer), '-screen', '0', '1400x1000x24', '-nolisten', 'tcp'], pass_fds=(writer,), stdout=log, stderr=log)
                os.close(writer)
                if not select.select([reader], [], [], 10)[0]: raise RuntimeError('No isolated display')
                display = ':' + os.read(reader, 50).decode().strip(); os.close(reader)
                env = {**os.environ, 'DISPLAY': display, 'LANGUAGE': 'en_US.UTF-8'}; env.pop('WAYLAND_DISPLAY', None)
                command = ['microsoft-edge', '--ozone-platform=x11', f'--user-data-dir={root}/profile', '--no-first-run', '--no-default-browser-check',
                           f'--disable-extensions-except={repo}/dist-controlled', f'--load-extension={repo}/dist-controlled', '--remote-debugging-port=0',
                           '--window-size=1300,900', '--window-position=0,0', 'about:blank']
                port_file = root / 'profile/DevToolsActivePort'

                def launch():
                    nonlocal browser
                    port_file.unlink(missing_ok=True)
                    browser = subprocess.Popen(command, env=env, stdout=log, stderr=log)
                    wait_for(port_file.exists)
                    port = int(port_file.read_text().splitlines()[0])
                    def targets():
                        with urllib.request.urlopen(f'http://localhost:{port}/json/list', timeout=2) as response: return json.load(response)
                    def connect(suffix):
                        target = wait_for(lambda: next((item for item in targets() if item['url'].endswith(suffix)), None))
                        cdp = CDP(target['webSocketDebuggerUrl']); connections.append(cdp); return cdp
                    worker = connect('/worker.js')
                    time.sleep(.3)
                    key(display, 'Alt_L', 'Shift_L', 'k')
                    panel = connect('/panel.html')
                    wait_for(lambda: panel.evaluate("document.querySelector('#active-settings')?.textContent.includes(' · ')"))
                    return worker, panel, connect

                worker, panel, connect = launch()
                snapshot_js = "(async()=>{const w=await chrome.windows.getCurrent();return chrome.runtime.sendMessage({type:'snapshot',windowId:w.id})})()"
                def snapshot(): return panel.evaluate(snapshot_js)
                def state(): return snapshot().get('state')
                def calls(): return worker.evaluate('globalThis.__tenshoControlledCalls ?? []')
                def select_value(selector, value):
                    panel.evaluate("(()=>{const e=document.querySelector(" + json.dumps(selector) + ");e.value=" + json.dumps(value) + ";e.dispatchEvent(new Event('change',{bubbles:true}))})()")
                def settled(status):
                    return wait_for(lambda: (lambda value: value if value and value['status'] == status else None)(state()))

                source_tab = snapshot()['tabId']
                def quick_language(value):
                    before = snapshot()['settings']['revision']
                    select_value('#lookup-language', value)
                    wait_for(lambda: snapshot()['settings']['revision'] != before)
                    wait_for(lambda: panel.evaluate("!document.querySelector('#language-controls').disabled"))
                    return snapshot()['settings']
                def return_to_source():
                    options.evaluate('chrome.tabs.update(' + str(source_tab) + ',{active:true})')
                    wait_for(lambda: snapshot()['tabId'] == source_tab)
                initial = snapshot()['settings']; evidence['initial_settings'] = initial
                checks['fresh_latin_english'] = initial['lookupLanguage'] == 'lat' and initial['languages']['lat']['explanationLanguage'] == 'en'
                checks['sidebar_contains_only_daily_controls'] = panel.evaluate("!document.querySelector('#settings-editor') && !document.querySelector('#sites') && !document.querySelector('#word-help') && document.querySelector('#active-settings').textContent==='Latin · English'")
                checks['single_explanation_choice_is_plain_text'] = panel.evaluate("document.querySelector('#explanation-language').hidden && document.querySelector('#explanation-value').textContent==='Explanations: English'")
                panel.evaluate("document.querySelector('#word').value='important';document.querySelector('#lookup').requestSubmit()")
                latin = settled('complete')
                checks['important_uses_latin_identity'] = latin['identity']['lookupLanguage'] == 'lat' and calls() == ['important']
                def capture(context, name):
                    (output / (name + '.png')).write_bytes(base64.b64decode(context.call('Page.captureScreenshot')['data']))
                wait_for(lambda: panel.evaluate("!!document.querySelector('.candidate')"))
                wait_for(lambda: panel.evaluate("!document.querySelector('#status').textContent.includes('Loading')"))
                capture(panel, 'reading-native')
                panel.evaluate("document.querySelector('#language-button').click()")
                wait_for(lambda: panel.evaluate("document.querySelector('#language-popover').matches(':popover-open')"))
                capture(panel, 'languages-native')
                panel.call('Input.dispatchKeyEvent', type='keyDown', key='Escape', code='Escape', windowsVirtualKeyCode=27)
                panel.call('Input.dispatchKeyEvent', type='keyUp', key='Escape', code='Escape', windowsVirtualKeyCode=27)
                checks['escape_dismisses_languages_before_sidebar'] = panel.evaluate("!document.querySelector('#language-popover').matches(':popover-open') && document.activeElement.id==='language-button'")
                for width, theme, zoom in [(280,'light',16),(480,'dark',16),(280,'light',32)]:
                    panel.call('Emulation.setDeviceMetricsOverride', width=width, height=900, deviceScaleFactor=1, mobile=False)
                    panel.call('Emulation.setEmulatedMedia', features=[{'name':'prefers-color-scheme','value':theme}])
                    panel.evaluate('document.documentElement.style.fontSize=' + json.dumps(str(zoom)+'px'))
                    checks[f'reading_no_horizontal_scroll_{width}_{theme}_{zoom}'] = panel.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    capture(panel, f'reading-{width}-{theme}-{zoom}')
                panel.evaluate("document.documentElement.style.fontSize=''")
                panel.call('Emulation.clearDeviceMetricsOverride')
                panel.call('Emulation.setEmulatedMedia', features=[])
                quick_language('san'); unavailable = settled('unavailable')
                checks['quick_language_refreshes_visible_selection'] = unavailable['text'] == 'important' and unavailable['identity']['lookupLanguage'] == 'san'
                checks['unconfigured_sanskrit_sends_no_call'] = calls() == ['important'] and unavailable['failureKind'] == 'unconfigured'
                checks['unavailable_preference_is_not_substituted'] = panel.evaluate("document.querySelector('#explanation-value').textContent==='Explanations: English · unavailable'")
                quick_language('lat'); settled('complete')
                checks['switch_back_reruns_same_selection'] = calls() == ['important', 'important']
                before_settings = state()
                panel.evaluate("document.querySelector('#open-settings').click()")
                options = connect('/options.html')
                wait_for(lambda: options.evaluate("!!document.querySelector('#provider-analysis-0')"))
                capture(options, 'settings-native')
                for width, theme, zoom in [(360,'light',16),(1000,'dark',16),(320,'light',32)]:
                    options.call('Emulation.setDeviceMetricsOverride', width=width, height=1100, deviceScaleFactor=1, mobile=False)
                    options.call('Emulation.setEmulatedMedia', features=[{'name':'prefers-color-scheme','value':theme}])
                    options.evaluate('document.documentElement.style.fontSize=' + json.dumps(str(zoom)+'px'))
                    checks[f'settings_no_horizontal_scroll_{width}_{theme}_{zoom}'] = options.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    capture(options, f'settings-{width}-{theme}-{zoom}')
                options.evaluate("document.documentElement.style.fontSize=''")
                options.call('Emulation.clearDeviceMetricsOverride')
                options.call('Emulation.setEmulatedMedia', features=[])
                options.evaluate('chrome.tabs.getCurrent().then(t=>chrome.tabs.setZoom(t.id,2))')
                checks['settings_actual_browser_zoom_200_percent'] = options.evaluate('chrome.tabs.getCurrent().then(t=>chrome.tabs.getZoom(t.id))')==2
                checks['settings_actual_zoom_has_no_horizontal_scroll'] = options.evaluate('document.documentElement.scrollWidth<=innerWidth')
                capture(options, 'settings-browser-zoom-200')
                options.evaluate('chrome.tabs.getCurrent().then(t=>chrome.tabs.setZoom(t.id,1))')
                options.evaluate("document.querySelector('a[href=\"#reading-sites\"]').click()")
                options_tab = options.evaluate('chrome.tabs.getCurrent().then(t=>t.id)')
                def config(): return options.evaluate("chrome.runtime.sendMessage({type:'settings-snapshot'})")
                def profile(value):
                    options.evaluate("(()=>{const e=document.querySelector('#profile-language');e.value=" + json.dumps(value) + ";e.dispatchEvent(new Event('change',{bubbles:true}))})()")
                def save_profile():
                    before = config()['settings']['revision']
                    options.evaluate("document.querySelector('#lookup-settings').requestSubmit()")
                    wait_for(lambda: config()['settings']['revision'] != before)
                    wait_for(lambda: options.evaluate("document.querySelector('#settings-message').textContent==='Settings saved.'"))
                    return config()['settings']
                checks['sidebar_opens_a_separate_options_tab'] = options_tab != source_tab and options.evaluate("chrome.runtime.getManifest().options_ui.open_in_tab")
                checks['settings_navigation_keeps_global_actions_available'] = options.evaluate("location.hash==='#reading-sites'") and 'settings' in config()
                checks['settings_snapshot_has_no_reading_tab_dependency'] = config()['settings'] == snapshot()['settings']
                return_to_source(); settled('complete')
                checks['settings_preserves_manual_blank_tab_reading'] = state()==before_settings and calls()==['important','important']
                panel.evaluate("document.querySelector('#open-settings').click()")
                wait_for(lambda: snapshot()['tabId']==options_tab)
                checks['sidebar_reuses_existing_settings_tab'] = options.evaluate("chrome.runtime.getContexts({contextTypes:['TAB']}).then(c=>c.filter(x=>x.documentUrl?.split(/[?#]/)[0]===chrome.runtime.getURL('options.html')).length===1)")
                profile('san')
                checks['profile_navigation_does_not_change_lookup_language'] = config()['settings']['lookupLanguage'] == 'lat' and options.evaluate("document.querySelectorAll('#settings-editor input[type=checkbox]').length===0 && document.querySelector('#save-settings').disabled")
                profile('lat')
                checks['singleton_provider_order_controls_hidden'] = options.evaluate("document.querySelectorAll('#settings-editor button[aria-label^=Move]').length===0")
                options.evaluate("document.querySelector('#provider-analysis-0').click()")
                wait_for(lambda: options.evaluate("document.querySelector('#settings-message').textContent==='Unsaved changes.'"))
                checks['provider_draft_is_not_applied'] = config()['settings']['languages']['lat']['analysis'][0]['enabled']
                options.evaluate("document.querySelector('#reload-settings').click()")
                checks['discard_restores_saved_provider_settings'] = options.evaluate("document.querySelector('#provider-analysis-0').checked && document.querySelector('#save-settings').disabled")
                options.evaluate("document.querySelector('#provider-analysis-0').click();document.querySelector('#provider-dictionary-0').click()")
                disabled = save_profile()
                checks['settings_tab_save_retains_global_language_and_preference'] = disabled['lookupLanguage']=='lat' and disabled['languages']['lat']['explanationLanguage']=='en'
                return_to_source(); disabled_state = settled('unavailable')
                checks['all_disabled_makes_no_call'] = disabled_state['failureKind'] == 'unconfigured' and len(calls()) == 2
                checks['disabled_language_preferences_remain_visible'] = panel.evaluate("document.querySelector('#active-settings').textContent==='Latin · English' && document.querySelector('#explanation-value').textContent.includes('unavailable')")
                options.evaluate("document.querySelector('#provider-analysis-0').click()")
                save_profile(); settled('complete')
                checks['analysis_only_refresh_preserves_dictionary_disabled'] = len(calls()) == 3 and snapshot()['settings']['languages']['lat']['dictionary'][0]['enabled'] is False
                checks['dictionary_capability_unavailable_visible'] = panel.evaluate("document.querySelector('#configuration-status').textContent==='Dictionary unavailable in English'")
                # Leave an options draft open, then change the shared language elsewhere.
                options.evaluate("document.querySelector('#provider-analysis-0').click()")
                saved = quick_language('san'); settled('unavailable')
                wait_for(lambda: options.evaluate("document.querySelector('#settings-message').textContent.includes('Settings changed elsewhere')"))
                options.evaluate("document.querySelector('#lookup-settings').requestSubmit()")
                wait_for(lambda: options.evaluate("document.querySelector('#settings-message').textContent.includes('Reload before saving')"))
                checks['stale_options_draft_cannot_overwrite_quick_preferences'] = config()['settings']==saved
                options.evaluate("document.querySelector('#reload-settings').click()")
                checks['discard_reloads_latest_configuration'] = options.evaluate("document.querySelector('#provider-analysis-0').checked && document.querySelector('#save-settings').disabled")
                evidence['settings_before_restart'] = saved
                new_tab = panel.evaluate("chrome.tabs.create({url:'about:blank',active:true}).then(tab=>tab.id)")
                wait_for(lambda: snapshot()['tabId'] == new_tab)
                checks['lookup_language_persists_across_tabs'] = snapshot()['settings']['lookupLanguage'] == 'san'
                checks['empty_state_language_visible'] = panel.evaluate("document.querySelector('#active-settings').textContent==='Sanskrit · English'") and state() is None
                panel.evaluate('chrome.tabs.update(' + str(source_tab) + ',{active:true})')
                wait_for(lambda: snapshot()['tabId'] == source_tab)
                try: worker.call('Browser.close')
                except Exception: pass
                browser.wait(timeout=10)
                for connection in connections: connection.ws.close()
                connections.clear()
                worker, panel, connect = launch()
                restored = snapshot()['settings']; evidence['settings_after_restart'] = restored
                checks['browser_restart_restores_exact_settings'] = restored == saved
                checks['browser_restart_does_not_lookup'] = calls() == [] and state() is None
                checks['restart_retains_visible_sanskrit_preference'] = panel.evaluate("document.querySelector('#active-settings').textContent==='Sanskrit · English'")
                evidence['passed'] = all(checks.values())
        except Exception as error:
            import traceback
            evidence['failure_trace'] = traceback.format_exc()
            evidence['failure'] = str(error); evidence['passed'] = False
            try:
                evidence['failure_snapshot'] = snapshot()
                evidence['failure_body'] = panel.evaluate('document.body.innerText')
            except Exception: pass
        finally:
            for connection in connections: connection.ws.close()
            for process in [browser, xvfb]:
                if process:
                    process.terminate()
                    try: process.wait(timeout=8)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
    (output / 'results.json').write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n')
    return evidence


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    result = run(parser.parse_args().output)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
