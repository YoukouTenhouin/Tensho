"""Cross-tab configuration acceptance using the disposable session runner."""
import json
from reading_workflow import wait_for


def exercise_consistency(evidence, panel, worker, page, snapshot, submit, reopen, connect, target, url):
    checks = evidence['checks']
    def calls(): return worker.evaluate('globalThis.__tenshoRecoveryCalls ?? []')
    def saved(tab):
        return panel().evaluate("chrome.storage.session.get('readingResults').then(v=>v.readingResults.tabs[" + str(tab) + "])")
    def activate(tab):
        panel().evaluate('chrome.tabs.update(' + str(tab) + ',{active:true})')
        reopen(); wait_for(lambda: snapshot()['tabId'] == tab)
    def configure(order=None, enabled=True):
        settings = snapshot()['settings']
        if order:
            rows = settings['languages']['lat']['analysis']
            settings['languages']['lat']['analysis'] = sorted(rows, key=lambda row: order.index(row['id']))
        else:
            for role in ['analysis', 'dictionary']:
                for row in settings['languages']['lat'][role]: row['enabled'] = enabled and row['id'] in ['a-first', 'd-first']
        current = snapshot()
        message = {'type': 'save-settings', 'windowId': panel().evaluate('chrome.windows.getCurrent().then(w=>w.id)'),
                   'tabId': current['tabId'], 'expectedRevision': settings['revision'], 'settings': settings}
        result = panel().evaluate('chrome.runtime.sendMessage(' + json.dumps(message) + ')')
        assert result.get('ok'), result
        return result['settings']['revision']
    def choose(selector):
        wait_for(lambda: panel().evaluate('!!document.querySelector(' + json.dumps(selector) + ')'))
        panel().evaluate('document.querySelector(' + json.dumps(selector) + ').click()')
    def complete(text):
        return wait_for(lambda: (lambda state: state if state and state['status'] == 'complete' and state['text'] == text else None)(snapshot().get('state')))

    submit('malum'); first = snapshot()['tabId']
    second = panel().evaluate('chrome.tabs.create({url:' + json.dumps(url + '?second') + ',active:true}).then(t=>t.id)')
    reopen(); wait_for(lambda: snapshot()['tabId'] == second)
    checks['fresh_tab_does_not_show_other_selection'] = snapshot().get('state') is None
    submit('puella'); before = len(calls())
    revision = configure(['a-second', 'a-first', 'a-denied', 'a-disabled'])
    visible = complete('puella')
    checks['provider_reorder_refreshes_only_visible_tab'] = calls()[before:] == ['a-second:analysis:puella'] and visible['identity']['configuration'] == revision
    hidden = saved(first)['value']
    checks['hidden_result_is_deferred_without_old_analysis'] = hidden['state']['status'] == 'notice' and hidden['state']['refreshOnView'] and hidden['dictionaries'] == {}
    activate(first); refreshed = complete('malum')
    checks['viewing_hidden_tab_refreshes_with_new_provider'] = calls()[before:] == ['a-second:analysis:puella', 'a-second:analysis:malum'] and refreshed['analysis']['provider'] == 'a-second'
    count = len(calls()); activate(second); complete('puella'); activate(first); complete('malum')
    checks['switching_current_results_does_not_repeat_requests'] = len(calls()) == count
    configure(enabled=False)
    wait_for(lambda: snapshot().get('state', {}).get('status') == 'unavailable')
    checks['all_disabled_visible_state_sends_no_request'] = len(calls()) == count and snapshot()['state']['failureKind'] == 'unconfigured'
    activate(second)
    wait_for(lambda: snapshot().get('state', {}).get('status') == 'unavailable')
    checks['all_disabled_deferred_tab_sends_no_request'] = len(calls()) == count and snapshot()['state']['identity']['configuration'] == snapshot()['settings']['revision']
    configure(enabled=True); complete('puella')
    count = len(calls())
    worker.ws.close(); page.call('ServiceWorker.enable'); page.call('ServiceWorker.stopAllWorkers')
    wait_for(lambda: target('/worker.js') is None)
    snapshot(); worker = connect('/worker.js')
    checks['worker_restart_does_not_replay_hidden_deferred_work'] = calls() == []
    activate(first); complete('malum')
    checks['deferred_refresh_survives_actual_worker_restart'] = calls() == ['a-first:analysis:malum']
    checks['current_language_labels_match_result'] = panel().evaluate("document.querySelector('#active-settings').textContent.includes('Lookup: Latin')") and snapshot()['state']['identity']['lookupLanguage'] == 'lat'
    checks['session_keeps_one_current_result_per_tab'] = all(saved(tab)['value']['state']['identity']['configuration'] == snapshot()['settings']['revision'] for tab in [first, second])
    checks['session_remains_within_budget'] = panel().evaluate("chrome.storage.session.get('readingResults').then(v=>new TextEncoder().encode(JSON.stringify(v)).byteLength<=6*1024*1024)")
    panel().evaluate("document.querySelector('#word').value='malum puella';document.querySelector('#lookup').requestSubmit()")
    wait_for(lambda: snapshot().get('state', {}).get('passage', {}).get('original') == 'malum puella')
    choose('#passage-word-0')
    complete('malum')
    worker.evaluate("globalThis.__tenshoRecoveryScenario='session-long'")
    choose('#dictionary-0')
    wait_for(lambda: snapshot().get('dictionaries', {}).get('0', {}).get('resolution', {}).get('status') == 'complete')
    choose('#article-0-n1')
    wait_for(lambda: snapshot().get('dictionaries', {}).get('0', {}).get('articles', {}).get('n1', {}).get('status') == 'complete')
    panel().evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    panel().evaluate('window.scrollTo(0,900)')
    wait_for(lambda: snapshot()['scroll']['y'] == 900)
    choose('#passage-word-1')
    complete('puella')
    wait_for(lambda: panel().evaluate('window.scrollY') == 0)
    checks['new_passage_word_resets_result_scroll'] = snapshot()['scroll']['y'] == 0
    checks['scroll_reset_preserves_passage_controls'] = snapshot()['state']['passage']['original'] == 'malum puella' and panel().evaluate("document.querySelectorAll('#passage-words button').length===2")
    evidence['provider_calls_after_restart'] = calls()
    evidence['passed'] = all(checks.values())
