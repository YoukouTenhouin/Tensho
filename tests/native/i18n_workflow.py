"""Chinese interface acceptance using the production session harness and controlled providers.

Run: node scripts/build.mjs --recovery; python3 tests/native/session_workflow.py --i18n --output <path>
No live provider requests or user browser/profile/audio changes.
"""
import base64
import json
from native_input import key
from reading_workflow import wait_for


def exercise_i18n(evidence, worker, panel, page, connect, target, display, output, close_browser, launch):
    checks = evidence['checks']
    snapshot_js = "chrome.windows.getCurrent().then(w=>chrome.runtime.sendMessage({type:'snapshot',windowId:w.id}))"
    def snapshot(): return panel.evaluate(snapshot_js)
    def calls(): return worker.evaluate('globalThis.__tenshoRecoveryCalls ?? []')
    def state(): return snapshot().get('state')
    def dictionary(): return snapshot().get('dictionaries', {}).get('0', {})
    def capture(context, name):
        (output / (name + '.png')).write_bytes(base64.b64decode(context.call('Page.captureScreenshot')['data']))
    def submit(text, status='complete'):
        previous = (state() or {}).get('generation', 0)
        panel.evaluate("globalThis.__previousI18nCandidate=document.querySelector('.candidate');document.querySelector('#word').value=" + json.dumps(text) + ";document.querySelector('#lookup').requestSubmit()")
        value = wait_for(lambda: (lambda value: value if value and value['generation'] > previous and value['text'] == text and value['status'] == status else None)(state()))
        if status == 'complete':
            wait_for(lambda: panel.evaluate("!!document.querySelector('.candidate') && document.querySelector('.candidate')!==globalThis.__previousI18nCandidate && document.querySelector('#analysis').getAttribute('aria-busy')==='false'"))
        return value
    def click(selector):
        wait_for(lambda: panel.evaluate('!!document.querySelector(' + json.dumps(selector) + ')'))
        panel.evaluate('document.querySelector(' + json.dumps(selector) + ').click()')

    initial = snapshot(); source_tab = initial['tabId']
    browser_language = worker.evaluate('chrome.i18n.getUILanguage()')
    evidence['browser_ui_language'] = browser_language
    checks['fresh_browser_default_is_simplified_chinese'] = initial['interfaceLanguage'] == 'auto' and initial['interfaceLocale'] == 'zh-Hans' and browser_language.lower().replace('_', '-').startswith('zh')
    checks['chinese_ui_keeps_latin_lookup_and_english_explanations'] = initial['settings']['lookupLanguage'] == 'lat' and initial['settings']['languages']['lat']['explanationLanguage'] == 'en' and panel.evaluate("document.querySelector('#active-settings').textContent==='拉丁语 · 英语'")
    checks['chinese_brand_titles_and_browser_metadata'] = panel.evaluate("document.querySelector('h1').textContent==='天书' && document.title==='天书查词' && chrome.runtime.getManifest().name.includes('天书')")
    checks['fresh_interface_has_no_provider_requests'] = calls() == []
    click('#open-settings'); options = connect('/options.html')
    wait_for(lambda: options.evaluate("!!document.querySelector('#interface-language') && !document.querySelector('#interface-language').disabled"))
    options_tab = options.evaluate('chrome.tabs.getCurrent().then(t=>t.id)')
    def config(): return options.evaluate("chrome.runtime.sendMessage({type:'settings-snapshot'})")
    def return_to_source():
        options.evaluate('chrome.tabs.update(' + str(source_tab) + ',{active:true})')
        wait_for(lambda: snapshot()['tabId'] == source_tab)
    def save_locale(value):
        options.evaluate("(()=>{const s=document.querySelector('#interface-language');s.value=" + json.dumps(value) + ";s.dispatchEvent(new Event('change',{bubbles:true}))})()")
        wait_for(lambda: config()['interfaceLanguage'] == value)
        wait_for(lambda: options.evaluate("!!document.querySelector('#interface-language') && !document.querySelector('#interface-language').disabled"))
        expected = 'en' if value == 'en' else 'zh-Hans'
        wait_for(lambda: panel.evaluate('document.documentElement.lang') == expected and options.evaluate('document.documentElement.lang') == expected)
    checks['settings_interface_selector_has_autonyms_and_browser_default'] = options.evaluate("Array.from(document.querySelector('#interface-language').options,o=>o.textContent).join('|')==='跟随浏览器（简体中文）|English|简体中文'")
    return_to_source(); page.evaluate('window.scrollTo(0,800)')
    worker.evaluate("globalThis.__tenshoRecoveryScenario='session-long'")
    original = submit('malum')
    checks['grammar_labels_translate_without_changing_values'] = panel.evaluate("document.querySelector('.grammar').textContent==='词性: noun, 格: nominative, 数: singular'")
    checks['provider_short_meaning_is_unchanged'] = panel.evaluate("Array.from(document.querySelectorAll('.candidate > p')).some(p=>p.textContent==='Controlled short meaning')")
    click('#dictionary-0'); wait_for(lambda: dictionary().get('resolution', {}).get('status') == 'complete')
    for entry in ['n1', 'n2']:
        click('#article-0-' + entry)
        wait_for(lambda: dictionary().get('articles', {}).get(entry, {}).get('status') == 'complete')
    wait_for(lambda: panel.evaluate("document.querySelectorAll('.dictionary-article').length===2"))
    panel.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    panel.evaluate('window.scrollTo(0,700)'); wait_for(lambda: snapshot()['scroll']['y'] == 700)
    before = snapshot(); before_calls = list(calls()); before_settings = config()['settings']
    provider = '#provider-analysis-2'
    options.evaluate("document.querySelector(" + json.dumps(provider) + ").click();document.querySelector('#origin').value='https://example.org'")
    wait_for(lambda: options.evaluate("!document.querySelector('#save-settings').disabled"))
    save_locale('en')
    after = snapshot()
    checks['interface_change_preserves_reading_identity_results_and_articles'] = after['state'] == before['state'] and after['dictionaries'] == before['dictionaries'] and after['settings'] == before_settings and calls() == before_calls
    wait_for(lambda: panel.evaluate('window.scrollY') == 700)
    checks['interface_change_preserves_panel_and_source_scroll'] = page.evaluate('window.scrollY') == 800 and after['scroll'] == before['scroll']
    checks['interface_change_preserves_unsaved_provider_draft_and_site_input'] = options.evaluate("!document.querySelector('#provider-analysis-2').checked && !document.querySelector('#save-settings').disabled && document.querySelector('#origin').value==='https://example.org'") and config()['settings'] == before_settings
    wait_for(lambda: options.evaluate("document.querySelector('#settings-message').textContent==='Unsaved changes.'"))
    checks['dirty_draft_message_relocalizes'] = True
    checks['english_override_translates_grammar_but_not_articles'] = panel.evaluate("document.querySelector('.grammar').textContent==='Part of speech: noun, Case: nominative, Number: singular' && document.querySelectorAll('.dictionary-article p[lang=en]').length===200")
    checks['locale_change_does_not_reannounce_completed_dictionary_actions'] = panel.evaluate("document.querySelector('#dictionary-status').textContent===''")

    # Exercise the selector using actual native keyboard input in the options tab.
    options.evaluate('chrome.tabs.update(' + str(options_tab) + ',{active:true})'); options.call('Page.bringToFront')
    options.evaluate("document.querySelector('#interface-language').focus()")
    key(display, 'End')
    wait_for(lambda: config()['interfaceLanguage'] == 'zh-Hans')
    wait_for(lambda: options.evaluate("!!document.querySelector('#interface-language') && !document.querySelector('#interface-language').disabled && document.documentElement.lang==='zh-Hans'"))
    wait_for(lambda: options.evaluate("document.activeElement.id==='interface-language'"))
    checks['native_keyboard_changes_interface_language_and_retains_focus'] = options.evaluate("document.activeElement.id==='interface-language'")
    wait_for(lambda: options.evaluate("document.querySelector('#interface-message').textContent==='界面语言已保存。'"))
    capture(options, 'settings-chinese')
    return_to_source(); wait_for(lambda: panel.evaluate('document.documentElement.lang') == 'zh-Hans')
    panel.evaluate('window.scrollTo(0,0)'); wait_for(lambda: snapshot()['scroll']['y'] == 0)
    capture(panel, 'reading-chinese')
    panel.evaluate('window.scrollTo(0,700)'); wait_for(lambda: snapshot()['scroll']['y'] == 700)
    panel.call('Accessibility.enable')
    names = [node.get('name', {}).get('value') for node in panel.call('Accessibility.getFullAXTree')['nodes']]
    checks['chinese_accessibility_names_reach_browser_tree'] = all(name in names for name in ['设置', '关闭查词', '单词或段落', '查词结果'])
    checks['chinese_dictionary_controls_and_source_text_coexist'] = panel.evaluate("document.querySelector('.dictionary').textContent.includes('收起词典') && document.querySelector('.dictionary').textContent.includes('词典来源') && document.querySelector('.dictionary-article > p').textContent.includes('Latin mālum and Greek ἅμα')")
    wait_for(lambda: worker.evaluate('chrome.action.getTitle({})') == '打开天书')
    checks['action_tooltip_follows_explicit_interface_preference'] = True
    for width, theme, zoom in [(280, 'light', 16), (480, 'dark', 16), (280, 'light', 32)]:
        panel.call('Emulation.setDeviceMetricsOverride', width=width, height=900, deviceScaleFactor=1, mobile=False)
        panel.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': theme}])
        panel.evaluate('document.documentElement.style.fontSize=' + json.dumps(str(zoom) + 'px'))
        checks[f'chinese_reading_no_horizontal_scroll_{width}_{theme}_{zoom}'] = panel.evaluate('document.documentElement.scrollWidth<=innerWidth')
        capture(panel, f'chinese-reading-{width}-{theme}-{zoom}')
    panel.evaluate("document.documentElement.style.fontSize=''"); panel.call('Emulation.clearDeviceMetricsOverride'); panel.call('Emulation.setEmulatedMedia', features=[])
    for width, theme, zoom in [(360, 'light', 16), (1000, 'dark', 16), (320, 'light', 32)]:
        options.call('Emulation.setDeviceMetricsOverride', width=width, height=1100, deviceScaleFactor=1, mobile=False)
        options.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': theme}])
        options.evaluate('document.documentElement.style.fontSize=' + json.dumps(str(zoom) + 'px'))
        checks[f'chinese_settings_no_horizontal_scroll_{width}_{theme}_{zoom}'] = options.evaluate('document.documentElement.scrollWidth<=innerWidth')
        capture(options, f'chinese-settings-{width}-{theme}-{zoom}')
    options.evaluate("document.documentElement.style.fontSize=''"); options.call('Emulation.clearDeviceMetricsOverride'); options.call('Emulation.setEmulatedMedia', features=[])
    options.evaluate("document.querySelector('#reload-settings').click()")

    worker.evaluate("globalThis.__tenshoRecoveryScenario=undefined")
    before_calls = list(calls())
    pending = submit('i18npending', 'loading')
    save_locale('en')
    during = state()
    checks['interface_change_during_request_keeps_generation_identity_and_single_attempt'] = during['generation'] == pending['generation'] and during['identity'] == pending['identity'] and calls() == before_calls + ['a-first:analysis:i18npending']
    completed = wait_for(lambda: (lambda value: value if value and value['text'] == 'i18npending' and value['status'] == 'complete' else None)(state()))
    checks['pending_request_completes_normally_after_interface_change'] = completed['generation'] == pending['generation'] and calls() == before_calls + ['a-first:analysis:i18npending']

    # Fail the actual preference write while leaving all other browser storage operations intact.
    worker.evaluate("globalThis.__i18nStorageSet=chrome.storage.local.set.bind(chrome.storage.local);chrome.storage.local.set=async value=>{if(Object.hasOwn(value,'interfaceLanguage'))throw new Error('Controlled storage failure');return globalThis.__i18nStorageSet(value)}")
    options.evaluate("(()=>{const s=document.querySelector('#interface-language');s.value='zh-Hans';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
    wait_for(lambda: options.evaluate("!!document.querySelector('#interface-language') && !document.querySelector('#interface-language').disabled && document.querySelector('#interface-message').textContent==='Something went wrong. Try again.'"))
    checks['failed_interface_save_retains_preference_reading_and_selector'] = config()['interfaceLanguage'] == 'en' and options.evaluate("document.querySelector('#interface-language').value==='en'") and state() == completed
    worker.evaluate('chrome.storage.local.set=globalThis.__i18nStorageSet;delete globalThis.__i18nStorageSet')
    before_calls = list(calls())
    invalid = submit('...', 'notice'); save_locale('zh-Hans')
    wait_for(lambda: panel.evaluate("document.querySelector('#status').textContent==='请选择或输入包含字母或数字的单词。未发送任何文本。'"))
    checks['retained_validation_notice_relocalizes_without_lookup'] = state() == invalid and calls() == before_calls
    passage = submit('arma virumque', 'notice')
    wait_for(lambda: panel.evaluate("!!document.querySelector('#passage-word-0')"))
    panel.evaluate("document.querySelector('#passage-word-0').focus()")
    save_locale('en')
    checks['passage_locale_change_preserves_words_focus_and_state'] = state() == passage and calls() == before_calls and panel.evaluate("document.activeElement.id==='passage-word-0' && document.querySelector('#passage-word-0').getAttribute('aria-label')==='Look up arma (word 1 of 2)'")
    save_locale('zh-Hans')
    checks['cached_passage_accessibility_labels_relocalize'] = panel.evaluate("document.querySelector('#passage-word-0').getAttribute('aria-label')==='查询 arma（第 1 个词，共 2 个）'")
    click('#passage-word-0'); wait_for(lambda: state()['status'] == 'complete')
    before_restart = snapshot()
    worker.ws.close(); page.call('ServiceWorker.enable'); page.call('ServiceWorker.stopAllWorkers')
    wait_for(lambda: target('/worker.js') is None)
    restarted = snapshot(); worker = connect('/worker.js')
    checks['worker_restart_retains_chinese_preference_and_same_reading_without_request'] = restarted['interfaceLanguage'] == 'zh-Hans' and restarted['state'] == before_restart['state'] and restarted['dictionaries'] == before_restart['dictionaries'] and calls() == []
    save_locale('auto')
    checks['browser_default_can_be_restored_without_configuration_edit'] = config()['interfaceLocale'] == 'zh-Hans' and config()['settings'] == before_settings and calls() == []
    save_locale('zh-Hans')
    close_browser(); worker, panel, page = launch()
    after_browser_restart = snapshot()
    checks['browser_restart_keeps_explicit_interface_preference_and_clears_only_reading_session'] = after_browser_restart['interfaceLanguage'] == 'zh-Hans' and after_browser_restart['interfaceLocale'] == 'zh-Hans' and after_browser_restart.get('state') is None and calls() == []
    evidence['i18n_scope'] = 'Actual Edge with Chinese browser UI; production locale storage, routing, retained state, UI and accessibility tree; controlled linguistic payloads; native keyboard language selection; no live provider requests.'
