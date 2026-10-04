"""Passage continuation through the actual extension with controlled analysis."""
import json
import time
from reading_workflow import wait_for


def exercise_passage(reading, native_key, connect, target, snapshot, url, evidence):
    checks = evidence['checks']
    worker = connect(wait_for(lambda: target('/worker.js')))
    def calls():
        return worker.evaluate('globalThis.__tenshoControlledCalls ?? []')
    reading.call('Page.navigate', url=url+'?passage')
    wait_for(lambda: reading.evaluate("!!document.querySelector('#second')"))
    time.sleep(.2)
    original = '  “Arma,”\nvirumque; mālum ma\u0304lum l’amour ab-cd 𐌀𐌁 controlled-failure.  '
    expected = ['Arma', 'virumque', 'mālum', 'ma\u0304lum', 'l’amour', 'ab-cd', '𐌀𐌁', 'controlled-failure']
    reading.evaluate("document.querySelector('#second').textContent="+json.dumps(original))
    reading.call('Page.bringToFront')
    rect = reading.evaluate("document.querySelector('#second').getBoundingClientRect().toJSON()")
    for event in ['mousePressed', 'mouseReleased']:
        reading.call('Input.dispatchMouseEvent', type=event, x=rect['x']+10, y=rect['y']+10, button='left', clickCount=1)
    reading.evaluate("(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('#second'));getSelection().removeAllRanges();getSelection().addRange(r)})()")
    fixture_text = original
    # Browser selection text reflects rendered whitespace, rather than raw DOM
    # textContent. The extension must retain exactly what the reader selected.
    original = reading.evaluate('getSelection().toString()')
    before = len(calls())
    native_key('Alt_L', 'Shift_L', 'l')
    panel = connect(wait_for(lambda: target('/panel.html')))
    def state(): return panel.evaluate(snapshot)['state']
    wait_for(lambda: state().get('passage'))
    passage = state()['passage']; passage_id = passage['id']
    wait_for(lambda: panel.evaluate("document.querySelectorAll('#passage-words button').length") == len(expected))
    checks['passage_original_and_spelling_retained'] = passage['original'] == original and [w['text'] for w in passage['words']] == expected and panel.evaluate("document.querySelector('#passage-original').textContent") == original
    checks['passage_opens_with_zero_analysis_calls'] = len(calls()) == before and state()['status'] == 'notice'
    wait_for(lambda: panel.evaluate("document.hasFocus() && document.activeElement.id==='results'"))
    native_key('Tab')
    checks['passage_button_has_native_focus_and_meaningful_name'] = panel.evaluate("document.activeElement.id==='passage-word-0' && document.activeElement.getAttribute('aria-label')==='Look up Arma (word 1 of 8)' && document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle!=='none'")
    native_key('Return')
    wait_for(lambda: state()['status'] == 'loading')
    checks['passage_controls_remain_during_loading'] = state()['text'] == 'Arma' and state()['passage']['id'] == passage_id and panel.evaluate("!document.querySelector('#passage').hidden && document.querySelectorAll('#passage-words button').length===8")
    wait_for(lambda: state()['status'] == 'complete')
    checks['native_choice_issues_only_chosen_word'] = calls()[before:] == ['Arma']
    checks['native_choice_retains_keyboard_focus'] = panel.evaluate("document.activeElement.id==='passage-word-0' && document.activeElement.getAttribute('aria-pressed')==='true'")
    native_key('Tab'); native_key('Return'); native_key('Tab'); native_key('Return')
    wait_for(lambda: state()['text'] == 'mālum' and state()['status'] == 'complete')
    time.sleep(.4)
    checks['rapid_native_choices_keep_latest_word_and_passage'] = state()['text'] == 'mālum' and state()['passage']['id'] == passage_id and calls()[before:] == ['Arma', 'virumque', 'mālum']
    for _ in range(5): native_key('Tab')
    native_key('Return')
    wait_for(lambda: state()['status'] == 'error')
    checks['failure_preserves_original_passage_and_controls'] = state()['text'] == 'controlled-failure' and state()['passage']['original'] == original and panel.evaluate("!document.querySelector('#passage').hidden && document.querySelectorAll('#passage-words button').length===8")
    prior = len(calls()); native_key('Tab'); native_key('Return')
    wait_for(lambda: len(calls()) > prior)
    checks['native_retry_preserves_passage_and_retries_one_word'] = calls()[prior:] == ['controlled-failure'] and state()['passage']['id'] == passage_id
    # Send a stale extension message while a newer lookup is actively loading.
    panel.evaluate("document.querySelector('#word').value='cano';document.querySelector('#lookup').requestSubmit()")
    wait_for(lambda: state()['text'] == 'cano' and state()['status'] == 'loading')
    panel.evaluate("(async()=>{const s=await "+snapshot+";const w=await chrome.windows.getCurrent();return chrome.runtime.sendMessage({type:'passage-word',tabId:s.tabId,windowId:w.id,passageId:"+str(passage_id)+",wordIndex:0})})()")
    wait_for(lambda: state()['text'] == 'cano' and state()['status'] == 'complete')
    checks['stale_passage_message_does_not_cancel_newer_lookup'] = state()['text'] == 'cano' and not state().get('passage')
    # A fresh explicit selection replaces controls; its whole-input validation
    # rejects oversized offered words/counts before the controlled adapter runs.
    def manual(text):
        previous = state()['generation']
        panel.evaluate("document.querySelector('#word').value="+json.dumps(text)+";document.querySelector('#lookup').requestSubmit()")
        return wait_for(lambda: (lambda s: s if s['generation'] > previous and s['status'] != 'loading' else None)(state()))
    prior = len(calls())
    too_many = manual(' '.join(['a']*257))
    too_long = manual('arma '+'𐌀'*257)
    punctuation = manual('—?!')
    checks['invalid_passages_send_nothing_and_explain_limits'] = '256 offered words' in too_many.get('message', '') and '256 Unicode code points' in too_long.get('message', '') and 'letters or numbers' in punctuation.get('message', '') and len(calls()) == prior
    checks['lookup_language_remains_visible_on_error'] = panel.evaluate("document.body.textContent.includes('Lookup: Latin')")
    checks['replacement_selection_clears_passage_controls'] = panel.evaluate("document.querySelector('#passage').hidden")
    evidence['passage'] = {'fixture_text': fixture_text, 'original': original, 'offered_words': expected, 'analysis_calls': calls()[before:], 'native_keyboard': True}


def exercise_live_passage(panel, snapshot, requests, evidence):
    checks = evidence['checks']
    def state(): return panel.evaluate(snapshot)['state']
    before = len(requests())
    original = '  “important,” mālum  '
    panel.evaluate("document.querySelector('#word').value="+json.dumps(original)+";document.querySelector('#lookup').requestSubmit()")
    wait_for(lambda: state().get('passage'))
    passage_id = state()['passage']['id']
    checks['live_passage_sends_no_automatic_request'] = len(requests()) == before and state()['passage']['original'] == original
    wait_for(lambda: panel.evaluate("!!document.querySelector('#passage-word-0')"))
    panel.evaluate("document.querySelector('#passage-word-0').click()")
    live = wait_for(lambda: (lambda s: s if s['status'] in ['complete', 'error'] else None)(state()), seconds=35)
    checks['passage_choice_uses_live_latin_analysis'] = live['status'] == 'complete' and live['analysis']['candidates'][0]['lemma'].startswith('importo,') and live['passage']['id'] == passage_id
    checks['live_passage_sends_only_selected_word'] = len(requests()) == before + 1 and 'word=important&' in requests()[-1]['url']
    panel.evaluate("chrome.permissions.remove({origins:['https://morph.alpheios.net/*']})")
    panel.evaluate("document.querySelector('#passage-word-1').click()")
    denied = wait_for(lambda: (lambda s: s if s['text'] == 'mālum' and s['status'] == 'error' else None)(state()))
    checks['passage_error_keeps_controls_without_access'] = denied.get('failureKind') == 'missing-access' and denied['passage']['id'] == passage_id and len(requests()) == before + 1
    wait_for(lambda: panel.evaluate("!document.querySelector('#retry').hidden"))
    panel.evaluate("document.querySelector('#retry').click()")
    retried = wait_for(lambda: (lambda s: s if s['generation'] > denied['generation'] and s['status'] == 'error' else None)(state()))
    checks['live_passage_retry_preserves_original_without_request'] = retried['passage']['original'] == original and len(requests()) == before + 1
    evidence['provider_requests'] = requests()
    evidence['live_passage'] = {'original': original, 'offered_words': [w['text'] for w in live['passage']['words']], 'selected_word': live['text'], 'provider': live['analysis']['provider']}
