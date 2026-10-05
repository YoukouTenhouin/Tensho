"""Exercise sidebar configuration and profile restart in isolated native Edge.

Run after npm run build:controlled. Only analysis responses are controlled;
configuration storage, routing, sidebar UI and browser lifecycle are production.
"""
import argparse
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
                env = {**os.environ, 'DISPLAY': display}; env.pop('WAYLAND_DISPLAY', None)
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
                    wait_for(lambda: panel.evaluate("document.querySelector('#active-settings')?.textContent.startsWith('Lookup:')"))
                    return worker, panel

                worker, panel = launch()
                snapshot_js = "(async()=>{const w=await chrome.windows.getCurrent();return chrome.runtime.sendMessage({type:'snapshot',windowId:w.id})})()"
                def snapshot(): return panel.evaluate(snapshot_js)
                def state(): return snapshot().get('state')
                def calls(): return worker.evaluate('globalThis.__tenshoControlledCalls ?? []')
                def select_value(selector, value):
                    panel.evaluate("(()=>{const e=document.querySelector(" + json.dumps(selector) + ");e.value=" + json.dumps(value) + ";e.dispatchEvent(new Event('change',{bubbles:true}))})()")
                def save():
                    before = snapshot()['settings']['revision']
                    panel.evaluate("document.querySelector('#lookup-settings').requestSubmit()")
                    wait_for(lambda: snapshot()['settings']['revision'] != before)
                    wait_for(lambda: panel.evaluate("document.querySelector('#settings-message').textContent.startsWith('Settings saved.')"))
                    return snapshot()['settings']
                def settled(status):
                    return wait_for(lambda: (lambda value: value if value and value['status'] == status else None)(state()))

                initial = snapshot()['settings']; evidence['initial_settings'] = initial
                checks['fresh_latin_english'] = initial['lookupLanguage'] == 'lat' and initial['languages']['lat']['explanationLanguage'] == 'en'
                checks['separate_labelled_controls'] = panel.evaluate("document.querySelector('label[for=lookup-language]').textContent==='Lookup' && document.querySelector('label[for=explanation-language]').textContent==='Explanations'")
                panel.evaluate("document.querySelector('#word').value='important';document.querySelector('#lookup').requestSubmit()")
                latin = settled('complete')
                checks['important_uses_latin_identity'] = latin['identity']['lookupLanguage'] == 'lat' and calls() == ['important']
                panel.evaluate("document.querySelector('#settings').open=true")
                select_value('#lookup-language', 'san')
                wait_for(lambda: panel.evaluate("document.querySelector('#settings-message').textContent.includes('Unsaved changes')"))
                checks['draft_does_not_relabel_result'] = panel.evaluate("document.querySelector('#active-settings').textContent.includes('Lookup: Latin') && document.querySelector('#settings-message').textContent.includes('Unsaved changes')") and state()['identity']['lookupLanguage'] == 'lat'
                saved_sanskrit = save(); unavailable = settled('unavailable')
                checks['language_save_refreshes_visible_selection'] = unavailable['text'] == 'important' and unavailable['identity']['lookupLanguage'] == 'san' and unavailable['identity']['configuration'] == saved_sanskrit['revision']
                checks['unconfigured_sanskrit_sends_no_call'] = calls() == ['important'] and unavailable['failureKind'] == 'unconfigured'
                checks['unavailable_language_visible'] = panel.evaluate("document.querySelector('#active-settings').textContent.includes('Lookup: Sanskrit') && document.querySelector('#active-settings').textContent.includes('unavailable')")
                checks['no_planned_sanskrit_providers'] = panel.evaluate("document.querySelectorAll('#settings-editor input[type=checkbox]').length===0")
                select_value('#lookup-language', 'lat'); save(); settled('complete')
                checks['switch_back_reruns_same_selection'] = calls() == ['important', 'important'] and state()['identity']['lookupLanguage'] == 'lat'
                panel.evaluate("document.querySelector('#provider-analysis-0').click();document.querySelector('#provider-dictionary-0').click()")
                disabled = save(); disabled_state = settled('unavailable')
                checks['all_disabled_retains_preference_and_makes_no_call'] = disabled['languages']['lat']['explanationLanguage'] == 'en' and disabled_state['failureKind'] == 'unconfigured' and len(calls()) == 2
                checks['unavailable_preference_is_not_substituted'] = panel.evaluate("document.querySelector('#explanation-language').value==='en' && document.querySelector('#explanation-language').selectedOptions[0].disabled")
                panel.evaluate("document.querySelector('#provider-analysis-0').click()")
                save(); settled('complete')
                checks['analysis_only_refresh_preserves_dictionary_disabled'] = len(calls()) == 3 and snapshot()['settings']['languages']['lat']['dictionary'][0]['enabled'] is False
                checks['dictionary_capability_unavailable_visible'] = panel.evaluate("document.querySelector('#configuration-status').textContent.includes('Dictionary entries are unavailable')")
                select_value('#lookup-language', 'san'); saved = save(); settled('unavailable')
                evidence['settings_before_restart'] = saved
                # Change reading tabs: the explicit global language must follow.
                original_tab = snapshot()['tabId']
                new_tab = panel.evaluate("chrome.tabs.create({url:'about:blank',active:true}).then(tab=>tab.id)")
                wait_for(lambda: snapshot()['tabId'] == new_tab)
                checks['lookup_language_persists_across_tabs'] = snapshot()['settings']['lookupLanguage'] == 'san'
                checks['empty_state_language_visible'] = panel.evaluate("document.querySelector('#active-settings').textContent.includes('Lookup: Sanskrit')") and state() is None
                panel.evaluate('chrome.tabs.update(' + str(original_tab) + ',{active:true})')
                wait_for(lambda: snapshot()['tabId'] == original_tab)
                try: worker.call('Browser.close')
                except Exception: pass  # Closing the browser can close CDP before its reply.
                browser.wait(timeout=10)
                for connection in connections: connection.ws.close()
                connections.clear()
                worker, panel = launch()
                restored = snapshot()['settings']; evidence['settings_after_restart'] = restored
                checks['browser_restart_restores_exact_settings'] = restored == saved
                checks['browser_restart_does_not_lookup'] = calls() == [] and state() is None
                checks['restart_retains_visible_sanskrit_preference'] = panel.evaluate("document.querySelector('#active-settings').textContent==='Lookup: Sanskrit · Explanations: English (unavailable)'")
                select_value('#lookup-language', 'lat'); save()
                checks['per_language_provider_preferences_restored'] = panel.evaluate("document.querySelector('#provider-analysis-0').checked && !document.querySelector('#provider-dictionary-0').checked")
                checks['one_provider_order_controls_present'] = panel.evaluate("Array.from(document.querySelectorAll('#settings-editor button[aria-label^=Move]')).length===4 && Array.from(document.querySelectorAll('#settings-editor button[aria-label^=Move]')).every(button=>button.disabled)")
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
