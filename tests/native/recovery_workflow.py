"""Native sidebar recovery acceptance; build with node scripts/build.mjs --recovery.

Controlled declarations/adapters use the production coordinator, router, executor,
settings, permissions checks and UI. Extra providers never enter the shipping build.
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
                'controlled_providers': True, 'production_coordination_routing_and_ui': True, 'checks': {}}
    checks = evidence['checks']; connections = []; browser = xvfb = None
    with tempfile.TemporaryDirectory(prefix='tensho-recovery-') as temporary:
        root = Path(temporary)
        try:
            with (output / 'browser.log').open('w') as log:
                reader, writer = os.pipe()
                xvfb = subprocess.Popen(['Xvfb', '-displayfd', str(writer), '-screen', '0', '1400x1000x24', '-nolisten', 'tcp'], pass_fds=(writer,), stdout=log, stderr=log)
                os.close(writer)
                if not select.select([reader], [], [], 10)[0]: raise RuntimeError('No isolated display')
                display = ':' + os.read(reader, 50).decode().strip(); os.close(reader)
                env = {**os.environ, 'DISPLAY': display}; env.pop('WAYLAND_DISPLAY', None)
                browser = subprocess.Popen(['microsoft-edge', '--ozone-platform=x11', f'--user-data-dir={root}/profile', '--no-first-run', '--no-default-browser-check',
                    f'--disable-extensions-except={repo}/dist-recovery', f'--load-extension={repo}/dist-recovery', '--remote-debugging-port=0',
                    '--window-size=1300,900', '--window-position=0,0', 'about:blank'], env=env, stdout=log, stderr=log)
                port_file = root / 'profile/DevToolsActivePort'; wait_for(port_file.exists)
                port = int(port_file.read_text().splitlines()[0])
                def targets():
                    with urllib.request.urlopen(f'http://localhost:{port}/json/list', timeout=2) as response: return json.load(response)
                def connect(suffix):
                    target = wait_for(lambda: next((item for item in targets() if item['url'].endswith(suffix)), None))
                    cdp = CDP(target['webSocketDebuggerUrl']); connections.append(cdp); return cdp
                worker = connect('/worker.js'); time.sleep(.3); key(display, 'Alt_L', 'Shift_L', 'k')
                panel = connect('/panel.html')
                wait_for(lambda: panel.evaluate("document.querySelector('#active-settings')?.textContent.includes(' · ')"))
                snapshot_js = "(async()=>{const w=await chrome.windows.getCurrent();return chrome.runtime.sendMessage({type:'snapshot',windowId:w.id})})()"
                def snapshot(): return panel.evaluate(snapshot_js)
                def calls(): return worker.evaluate('globalThis.__tenshoRecoveryCalls ?? []')
                def body(): return panel.evaluate('document.body.innerText')
                def choose(selector, native=False):
                    wait_for(lambda: panel.evaluate('!!document.querySelector(' + json.dumps(selector) + ')'))
                    if native:
                        panel.evaluate('document.querySelector(' + json.dumps(selector) + ').focus()'); key(display, 'Return')
                    else: panel.evaluate('document.querySelector(' + json.dumps(selector) + ').click()')
                def submit(scenario):
                    before = snapshot().get('state', {}).get('generation', 0)
                    worker.evaluate('globalThis.__tenshoRecoveryScenario=' + json.dumps(scenario) + ';globalThis.__tenshoRecoveryCalls=[]')
                    panel.evaluate("globalThis.previousCandidate=document.querySelector('.candidate');document.querySelector('#word').value='important';document.querySelector('#lookup').requestSubmit()")
                    state = wait_for(lambda: (lambda value: value if value and value['generation'] > before and value['status'] != 'loading' else None)(snapshot().get('state')))
                    if state['status']=='complete' and state['analysis']['candidates']:
                        wait_for(lambda: panel.evaluate("!!document.querySelector('.candidate') && document.querySelector('.candidate')!==previousCandidate && document.querySelector('#analysis').getAttribute('aria-busy')==='false'"))
                    return state
                def dictionary(): return snapshot().get('dictionaries', {}).get('0')
                def resolved():
                    return wait_for(lambda: (lambda value: value if value and value['resolution']['status'] != 'loading' else None)(dictionary()))
                def article_done(entry, status='complete'):
                    return wait_for(lambda: (lambda value: value if value and value.get('articles', {}).get(entry, {}).get('status') == status else None)(dictionary()))

                state = submit('analysis-fallback')
                checks['later_analysis_provider_succeeds_once'] = state['analysis']['provider'] == 'a-second' and calls() == ['a-first:analysis:important', 'a-second:analysis:important']
                wait_for(lambda: 'Using a-second' in body())
                checks['analysis_warning_and_original_reason_visible'] = 'a-first: Connection failed.' in body() and 'Previous provider failed.' in body()
                checks['disabled_and_ungranted_analysis_not_called'] = not any('disabled' in call or 'denied' in call for call in calls())
                checks['missing_access_reason_visible_without_prompt'] = 'a-denied: Provider access needed. Skipped.' in body() and panel.evaluate('chrome.permissions.getAll().then(p=>p.origins.length===0)')
                state = submit('analysis-empty')
                wait_for(lambda: 'No Latin match' in body())
                checks['no_match_stops_chain_and_is_visible'] = state['analysis']['candidates'] == [] and calls() == ['a-first:analysis:important']
                state = submit('analysis-partial')
                checks['partial_analysis_stops_chain'] = state['analysis']['candidates'][0]['meanings'] == [] and calls() == ['a-first:analysis:important']
                state = submit('analysis-exhausted'); before = list(calls())
                checks['exhausted_analysis_has_explicit_retry'] = state['status'] == 'error' and panel.evaluate("!document.querySelector('#retry').hidden")
                worker.evaluate("globalThis.__tenshoRecoveryScenario='analysis-partial'"); choose('#retry', native=True)
                wait_for(lambda: snapshot()['state']['status'] == 'complete')
                checks['native_explicit_analysis_retry_one_attempt'] = calls() == before + ['a-first:analysis:important']

                state = submit('dictionary-resolve'); choose('#dictionary-0', native=True); candidate = resolved()
                checks['resolution_fallback_offers_later_alternatives'] = candidate['resolution']['value']['providerId'] == 'd-second' and candidate['articles'] == {}
                checks['resolution_calls_are_one_attempt_and_skip_ineligible'] = calls() == ['a-first:analysis:important', 'd-first:resolve:candidate-one', 'd-second:resolve:candidate-one']
                wait_for(lambda: 'Using d-second' in body())
                checks['dictionary_warning_and_uncertainty_visible'] = 'd-first: Provider unavailable.' in body() and 'Possible entries' in body()
                choose('#article-0-n1', native=True); candidate = article_done('n1')
                checks['later_article_requires_explicit_choice'] = calls()[-1] == 'd-second:article:n1' and candidate['articles']['n1']['value']['dictionary'] == 'd-second'
                checks['dictionary_does_not_rerun_or_erase_analysis'] = snapshot()['state'] == state and sum(':analysis:' in call for call in calls()) == 1
                wait_for(lambda: 'Latin mālum and Greek ἅμα' in body())
                checks['full_article_and_embedded_quotes_visible'] = 'Complete d-second n1 article.' in body()
                for scenario, expected in [('absence', 'confirmed-absence'), ('unresolved', 'unresolved-mapping')]:
                    submit(scenario); choose('#dictionary-0'); candidate = resolved()
                    checks[scenario + '_terminates_without_later_dictionary'] = candidate['resolution']['value']['status'] == expected and calls() == ['a-first:analysis:important', 'd-first:resolve:candidate-one']
                state = submit('article-fallback'); choose('#dictionary-0'); resolved(); choose('#article-0-n1', native=True)
                candidate = wait_for(lambda: (lambda value: value if value and value['resolution']['status'] == 'complete' and value['resolution']['value']['providerId'] == 'd-second' else None)(dictionary()))
                checks['failed_first_article_offers_new_choices_only'] = candidate['articles'] == {} and calls() == ['a-first:analysis:important', 'd-first:resolve:candidate-one', 'd-first:article:n1', 'd-second:resolve:candidate-one']
                wait_for(lambda: 'd-first: Unexpected dictionary entry.' in body())
                checks['article_failure_warning_visible'] = 'Using d-second' in body()
                choose('#article-0-n1', native=True); article_done('n1')
                checks['replacement_article_requires_new_choice'] = calls()[-1] == 'd-second:article:n1' and snapshot()['state'] == state
                state = submit('article-partial'); choose('#dictionary-0'); resolved(); choose('#article-0-n1'); first = article_done('n1')['articles']['n1']
                choose('#article-0-n2'); candidate = article_done('n2', 'error')
                checks['post_success_failure_stays_local'] = candidate['articles']['n1'] == first and calls() == ['a-first:analysis:important', 'd-first:resolve:candidate-one', 'd-first:article:n1', 'd-first:article:n2']
                wait_for(lambda: 'Retry entry' in body())
                worker.evaluate("globalThis.__tenshoRecoveryScenario='recovered'"); choose('#article-0-n2', native=True); candidate = article_done('n2')
                checks['native_local_retry_preserves_prior_article_and_analysis'] = candidate['articles']['n1'] == first and snapshot()['state'] == state and calls()[-1] == 'd-first:article:n2'
                # Real 15-second request / 30-second action bounds, not shortened fixture clocks.
                submit('deadline'); choose('#dictionary-0'); resolved(); started = time.monotonic(); choose('#article-0-n1')
                candidate = wait_for(lambda: (lambda value: value if value and value['resolution']['status'] == 'error' else None)(dictionary()), seconds=36)
                elapsed = time.monotonic() - started; evidence['deadline_elapsed_seconds'] = elapsed
                failure = candidate['resolution']; evidence['deadline_failure'] = failure; evidence['deadline_calls'] = calls()
                checks['real_action_deadline_stops_before_third_provider'] = failure['failureKind'] == 'action-deadline' and 29 <= elapsed < 35 and not any(call.startswith('d-third:') for call in calls())
                checks['deadline_preserves_first_failure_without_claiming_unattempted_failure'] = any(issue['providerId'] == 'd-first' and issue['kind'] == 'request-timeout' for issue in failure['providerIssues']) and not any(issue['providerId'] == 'd-third' for issue in failure['providerIssues'])
                wait_for(lambda: 'Retry dictionary' in body())
                checks['deadline_has_visible_explicit_retry'] = 'Lookup timed out.' in body()
                evidence['passed'] = all(checks.values())
        except Exception as error:
            evidence['failure'] = str(error); evidence['passed'] = False
            try: evidence['failure_snapshot'] = snapshot(); evidence['failure_body'] = body(); evidence['failure_calls'] = calls()
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
    result = run(parser.parse_args().output); print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
