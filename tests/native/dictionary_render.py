"""Controlled production extraction/coordinator/renderer path in actual Edge.

No provider calls. A separate test bundle leaves the unpacked build untouched.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request

from permission_scope import CDP
from reading_workflow import wait_for, version


def run(output):
    repo = Path(__file__).resolve().parents[2]
    fixtures = repo/'tests/fixtures/lewis-short'
    manifest = json.loads((fixtures/'articles.json').read_text())
    payload = {'articles': {item['entryId']: (fixtures/(item['entryId']+'.html')).read_text() for item in manifest}, 'hostile': (fixtures/'hostile.html').read_text()}
    expected = json.loads((fixtures/'readable-text.json').read_text())
    evidence = {'observed_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'browser': version(['microsoft-edge', '--version']),
                'mode': 'headless Edge; controlled responses through production modules', 'live_provider_requests': False, 'checks': {}}
    output.mkdir(parents=True, exist_ok=True)
    browser = cdp = None
    with tempfile.TemporaryDirectory(prefix='tensho-dictionary-render-') as temporary:
        root = Path(temporary)
        bundle = root/'render.js'
        subprocess.run(['node_modules/.bin/esbuild', 'tests/dictionary-render-entry.ts', '--bundle', '--format=iife', '--global-name=TenshoDictionary', f'--outfile={bundle}'], cwd=repo, check=True)
        try:
            with (output/'browser.log').open('w') as log:
                browser = subprocess.Popen(['microsoft-edge', '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
                    '--disable-extensions', f'--user-data-dir={root}/profile', '--remote-debugging-port=0', 'about:blank'], stdout=log, stderr=log)
                port_file = root/'profile/DevToolsActivePort'; wait_for(port_file.exists)
                port = int(port_file.read_text().splitlines()[0])
                def target():
                    with urllib.request.urlopen(f'http://localhost:{port}/json/list', timeout=2) as response:
                        return next((item for item in json.load(response) if item['type'] == 'page'), None)
                cdp = CDP(wait_for(target)['webSocketDebuggerUrl'])
                # The ordinary page has no extension CSP hiding an unsafe renderer.
                control = cdp.evaluate("(()=>{window.providerActive=0;const b=document.createElement('button');b.setAttribute('onclick','window.providerActive++');document.body.append(b);b.click();return window.providerActive})()")
                cdp.evaluate('window.providerActive=0'); cdp.evaluate(bundle.read_text())
                result = cdp.evaluate('TenshoDictionary.exercise('+json.dumps(payload)+')')
                dom = cdp.evaluate("""(()=>({active:window.providerActive, articles:Array.from(document.querySelectorAll('.dictionary-article')).length,
                    text:Object.fromEntries(Array.from(document.querySelectorAll('[data-case]'),s=>[s.dataset.case,Array.from(s.querySelectorAll('.dictionary-article > p'),p=>p.textContent)])),
                    tags:Array.from(new Set(Array.from(document.body.querySelectorAll('*'),e=>e.tagName))),
                    unsafeAttributes:Array.from(document.body.querySelectorAll('*')).flatMap(e=>Array.from(e.attributes)).filter(a=>/^on/i.test(a.name)||['src','srcdoc','style'].includes(a.name)).length,
                    urls:Array.from(document.querySelectorAll('a'),a=>({href:a.href,rel:a.rel,target:a.target}))}))()""")
                checks = evidence['checks']
                checks['active_content_positive_control'] = control == 1
                checks['provider_content_never_executes'] = dom['active'] == 0 and cdp.evaluate('window.providerActive') == 0
                checks['complete_retained_text_survives_production_reading_path'] = all('\n'.join(result['articleTexts'][key]) == text for key, text in expected.items())
                checks['browser_displays_every_extracted_paragraph'] = dom['text'] == result['articleTexts']
                checks['hostile_prose_and_credits_retained'] = 'Readable & Latin mālum' in '\n'.join(dom['text']['n999']) and 'Attribution: Lewis & Short' in '\n'.join(dom['text']['n999'])
                checks['no_provider_elements_or_active_attributes'] = set(dom['tags']) <= {'SECTION', 'BUTTON', 'DIV', 'P', 'H4', 'H5', 'A', 'UL', 'LI'} and dom['unsafeAttributes'] == 0
                checks['links_revalidated_at_presentation'] = all(a['href'].startswith('https://') and '@' not in a['href'] and a['rel'] == 'noopener noreferrer' and a['target'] == '_blank' for a in dom['urls'])
                checks['multiple_articles_preserve_analysis'] = dom['articles'] == 14 and result['analysisPreserved']
                checks['single_cached_index_and_only_selected_articles'] = len(result['requests']) == 14
                terminal = result['terminal']
                checks['unresolved_absence_and_failure_stay_distinct'] = 'does not establish' in terminal['unresolved-mapping'] and 'confirmed that no entry' in terminal['confirmed-absence'] and 'Controlled identity mismatch' in terminal['technical-failure'] and 'Retry dictionary resolution' in terminal['technical-failure']
                evidence.update(passed=all(checks.values()), terminal_text=terminal, article_count=dom['articles'], safe_link_count=len(dom['urls']))
        except Exception as error:
            evidence.update(passed=False, failure=str(error))
        finally:
            if cdp: cdp.ws.close()
            if browser:
                browser.terminate()
                try: browser.wait(timeout=8)
                except subprocess.TimeoutExpired: browser.kill(); browser.wait()
    (output/'results.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2)+'\n')
    return evidence


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    result = run(parser.parse_args().output); print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['passed'] else 1)
