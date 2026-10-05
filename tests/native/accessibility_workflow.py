"""Keyboard and browser accessibility tree checks using the disposable session runner.

Learner actions use XTest keys; CDP observes state and selects controlled provider
outcomes. This isolated display check does not establish KDE or Orca support.
"""
import json

from native_input import key
from reading_workflow import wait_for


def exercise_accessibility(evidence, panel, worker, page, snapshot, display, target):
    checks = evidence['checks']
    evidence['accessibility_scope'] = 'Native X11 keyboard and Edge accessibility tree; separate KDE/Orca acceptance required'
    traversal = []

    def active():
        return panel.evaluate("({id:document.activeElement.id,tag:document.activeElement.tagName,focus:document.hasFocus()})")

    def reach(selector):
        for _ in range(100):
            if panel.evaluate('document.hasFocus() && document.activeElement.matches(' + json.dumps(selector) + ')'):
                return
            key(display, 'Tab')
            traversal.append(active())
        raise RuntimeError('Keyboard could not reach ' + selector)

    def submit(text):
        reach('#word')
        key(display, 'Control_L', 'a')
        for char in text: key(display, 'space' if char == ' ' else char)
        key(display, 'Return')

    def tree():
        return [node for node in panel.call('Accessibility.getFullAXTree')['nodes'] if not node.get('ignored')]

    def named(role, name):
        return any(n.get('role', {}).get('value') == role and n.get('name', {}).get('value') == name for n in tree())

    def announced(text):
        return wait_for(lambda: panel.evaluate('dictionaryAnnouncements.some(t=>t.includes(' + json.dumps(text) + '))'))

    checks['results_landmark_has_accessible_name'] = named('main', 'Lookup results')
    checks['manual_input_has_accessible_label'] = named('textbox', 'Word or passage to look up')
    checks['close_has_accessible_name'] = named('button', 'Close lookup')
    reach('#word')
    checks['keyboard_focus_is_visible'] = panel.evaluate("document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle!=='none' && parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2")
    submit('sessionpending')
    wait_for(lambda: snapshot().get('state', {}).get('status') == 'loading')
    checks['analysis_loading_has_live_status'] = panel.evaluate("document.querySelector('#status').textContent.includes('Loading') && document.querySelector('#status').getAttribute('aria-live')==='polite' && document.querySelector('#status').getAttribute('aria-atomic')==='true' && document.querySelector('#analysis').getAttribute('aria-busy')==='true'")
    wait_for(lambda: snapshot().get('state', {}).get('status') == 'complete')
    checks['keyboard_submit_focuses_results'] = active()['id'] == 'results'
    panel.evaluate("globalThis.dictionaryAnnouncements=[];new MutationObserver(()=>dictionaryAnnouncements.push(document.querySelector('#dictionary-status').textContent)).observe(document.querySelector('#dictionary-status'),{childList:true,subtree:true,characterData:true})")
    panel.evaluate("globalThis.repeatedAnalysisAnnouncements=[];new MutationObserver(()=>repeatedAnalysisAnnouncements.push(document.querySelector('#status').textContent)).observe(document.querySelector('#status'),{childList:true,subtree:true,characterData:true})")
    reach('#dictionary-0'); key(display, 'Return')
    wait_for(lambda: snapshot().get('dictionaries', {}).get('0', {}).get('resolution', {}).get('status') == 'complete')
    checks['dictionary_toggle_exposes_expansion'] = panel.evaluate("document.querySelector('#dictionary-0').getAttribute('aria-expanded')==='true' && !document.querySelector('#dictionary-content-0').hidden")
    checks['dictionary_resolution_updates_persistent_live_region'] = announced('Correspondence is unverified')
    reach('#article-0-n1'); key(display, 'Return')
    wait_for(lambda: snapshot()['dictionaries']['0'].get('articles', {}).get('n1', {}).get('status') == 'complete')
    checks['article_replacement_keeps_keyboard_position'] = active()['id'] == 'article-0-n1-region'
    checks['article_completion_updates_live_region'] = announced('article n1: Full article')
    worker.evaluate("globalThis.__tenshoRecoveryScenario='article-partial'")
    reach('#article-0-n2'); key(display, 'Return')
    wait_for(lambda: snapshot()['dictionaries']['0'].get('articles', {}).get('n2', {}).get('status') == 'error')
    checks['local_article_error_updates_live_region'] = announced('article n2: ' + snapshot()['dictionaries']['0']['articles']['n2']['message'])
    worker.evaluate("globalThis.__tenshoRecoveryScenario=undefined")
    reach('#article-0-n2'); key(display, 'Return')
    wait_for(lambda: snapshot()['dictionaries']['0'].get('articles', {}).get('n2', {}).get('status') == 'complete')
    checks['keyboard_can_open_multiple_full_articles'] = panel.evaluate("document.querySelectorAll('.dictionary-article').length===2")
    before_announcements = panel.evaluate('dictionaryAnnouncements.length')
    reach('#dictionary-0'); key(display, 'Return')
    wait_for(lambda: snapshot()['dictionaries']['0']['expanded'] is False)
    key(display, 'Return'); wait_for(lambda: snapshot()['dictionaries']['0']['expanded'] is True)
    checks['cached_expansion_does_not_reannounce_completed_work'] = panel.evaluate('dictionaryAnnouncements.length') == before_announcements
    checks['dictionary_actions_do_not_repeat_unchanged_analysis_announcement'] = panel.evaluate('repeatedAnalysisAnnouncements.length===0')
    # Continuing through links and controls must escape the result subtree.
    reach('#word')
    checks['keyboard_can_leave_results_without_trap'] = active()['id'] == 'word'
    submit('malum puella')
    wait_for(lambda: snapshot().get('state', {}).get('passage') is not None)
    checks['new_selection_clears_previous_dictionary_announcement'] = panel.evaluate("document.querySelector('#dictionary-status').textContent==='' ")
    checks['passage_word_has_specific_accessible_name'] = named('button', 'Look up puella (word 2 of 2)')
    reach('#passage-word-1'); key(display, 'Return')
    wait_for(lambda: snapshot().get('state', {}).get('status') == 'complete')
    checks['keyboard_selects_passage_word'] = snapshot()['state']['passage']['selectedIndex'] == 1 and panel.evaluate("document.querySelector('#passage-word-1').getAttribute('aria-pressed')==='true'")
    worker.evaluate("globalThis.__tenshoRecoveryScenario='analysis-exhausted'")
    submit('malum')
    wait_for(lambda: snapshot().get('state', {}).get('status') == 'error')
    checks['analysis_error_has_live_status_and_named_retry'] = panel.evaluate("document.querySelector('#status').getAttribute('aria-live')==='polite' && document.querySelector('#status').getAttribute('aria-atomic')==='true' && document.querySelector('#status').textContent.length>0") and named('button', 'Retry Latin analysis')
    worker.evaluate("globalThis.__tenshoRecoveryScenario=undefined")
    reach('#retry'); key(display, 'Return')
    wait_for(lambda: snapshot().get('state', {}).get('status') == 'complete')
    checks['keyboard_retry_recovers'] = snapshot()['state']['text'] == 'malum'
    before_scroll = page.evaluate('window.scrollY')
    key(display, 'Escape'); wait_for(lambda: target('/panel.html') is None)
    checks['keyboard_escape_closes_without_page_scroll'] = page.evaluate('document.hasFocus() && window.scrollY===' + str(before_scroll))
    evidence['keyboard_traversal'] = traversal
    evidence['passed'] = all(checks.values())
