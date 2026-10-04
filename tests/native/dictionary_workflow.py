"""Live dictionary continuation using the production Latin runner's isolated Edge."""
import json
from reading_workflow import wait_for


def exercise_dictionary(panel, snapshot, requests, evidence):
    checks = evidence['checks']
    def state():
        return panel.evaluate(snapshot)
    def candidate():
        return state().get('dictionaries', {}).get('0', {})
    def click(selector):
        panel.evaluate(f'document.querySelector({selector!r}).click()')
    def resolved():
        result = candidate().get('resolution', {})
        return result if result.get('status') in ('complete', 'error') else None
    original = state()['state']
    checks['dictionary_starts_without_eager_requests'] = len(requests()) == 1 and not candidate()
    click('#dictionary-0')
    resolution = wait_for(resolved, seconds=35)
    evidence['live_dictionary_resolution'] = resolution
    assert resolution['status'] == 'complete', resolution
    alternatives = resolution['value']['alternatives']
    checks['live_singleton_requires_choice'] = len(alternatives) == 1 and alternatives[0]['entryId'] == 'n21985' and not candidate()['articles']
    checks['labels_precede_article_retrieval'] = len(requests()) == 2 and panel.evaluate("document.querySelector('.dictionary').textContent.includes('Index keys: importo') && document.querySelector('.dictionary').textContent.includes('unverified') && document.querySelector('.dictionary').textContent.includes('Lewis & Short')")
    click('#article-0-n21985')
    article = wait_for(lambda: (lambda a: a if a.get('status') in ('complete', 'error') else None)(candidate().get('articles', {}).get('n21985', {})), seconds=35)
    assert article['status'] == 'complete', article
    value = article['value']
    evidence['live_dictionary_article'] = {'entryId': value['entryId'], 'sourceUrl': value['sourceUrl'], 'paragraphCount': len(value['paragraphs']), 'textCharacters': sum(map(len, value['paragraphs'])), 'attribution': value['attribution']}
    wait_for(lambda: panel.evaluate("!!document.querySelector('.dictionary-article')"))
    checks['live_full_article_preserves_credit_and_all_paragraphs'] = panel.evaluate("Array.from(document.querySelectorAll('.dictionary-article > p'),p=>p.textContent)") == value['paragraphs'] and 'A Latin Dictionary' in ' '.join(value['attribution'])
    links = panel.evaluate("Array.from(document.querySelectorAll('.dictionary-article a'),a=>({href:a.href,rel:a.rel,target:a.target}))")
    checks['safe_successful_request_source_link'] = any(a['href'] == value['sourceUrl'] for a in links) and all(a['href'].startswith('https://') and a['rel'] == 'noopener noreferrer' and a['target'] == '_blank' for a in links)
    checks['dictionary_keeps_analysis_and_generation'] = state()['state'] == original
    checks['one_index_and_one_chosen_article_request'] = len(requests()) == 3
    click('#dictionary-0'); click('#dictionary-0')
    checks['reopening_keeps_article_without_request'] = candidate()['articles']['n21985']['status'] == 'complete' and len(requests()) == 3
    local = panel.evaluate('chrome.storage.local.get(null)')
    cache = local.get('latinDictionaryIndex', {})
    checks['persistent_cache_contains_index_only'] = sorted(cache) == ['key', 'storedAt', 'text'] and all(key in ['latinDictionaryIndex', 'latinAccessDecision', 'enabledOrigins', 'lookupSettings'] for key in local)
    settings = local.get('lookupSettings', {})
    checks['persistent_settings_do_not_contain_reading_results'] = sorted(settings) == ['languages', 'lookupLanguage', 'revision', 'schema'] and 'important' not in json.dumps(settings)
    current = state()
    session = panel.evaluate("chrome.storage.session.get('readingResults').then(v=>v.readingResults)")
    retained = session['tabs'][str(current['tabId'])]['value']
    checks['live_analysis_and_complete_article_retained_in_session'] = retained['state'] == original and retained['dictionaries']['0']['articles']['n21985']['value'] == value
    checks['live_session_within_serialized_budget'] = len(json.dumps({'readingResults': session}, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) <= 6 * 1024 * 1024
    # Revoke just dictionary access; a new explicit analysis still works. The fresh
    # persisted index must not bypass the permission guard for new resolution.
    panel.evaluate("chrome.permissions.remove({origins:['https://repos1.alpheios.net/*']})")
    panel.evaluate("document.querySelector('#word').value='important';document.querySelector('#lookup').requestSubmit()")
    wait_for(lambda: (lambda s: s and s['generation'] > original['generation'] and s['status'] == 'complete')(state().get('state')), seconds=35)
    wait_for(lambda: panel.evaluate("document.querySelector('#dictionary-0').getAttribute('aria-expanded') === 'false'"))
    click('#dictionary-0')
    denied = wait_for(resolved)
    checks['revoked_dictionary_access_blocks_cached_resolution'] = denied.get('failureKind') == 'missing-access' and len(requests()) == 4
    wait_for(lambda: panel.evaluate("!!document.querySelector('#dictionary-retry-0')"))
    click('#dictionary-retry-0')
    retried = wait_for(resolved)
    checks['dictionary_retry_is_local_without_access'] = retried.get('failureKind') == 'missing-access' and len(requests()) == 4 and state()['state']['status'] == 'complete'
    evidence['provider_requests'] = requests()
