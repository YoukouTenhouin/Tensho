# Interface i18n acceptance — #40

English and Simplified Chinese catalogs now cover extension-owned controls, language names, statuses, errors, accessibility labels and grammatical field labels. Settings saves an independent interface preference; Chinese UI + Latin lookup + English explanations preserves provider text and every lookup identity. The Chinese name is 天书. Browser-owned manifest metadata and shortcut descriptions follow browser locale; context menus and action tooltips follow the selected interface preference.

## Evidence

On 2026-10-07, `npm run check` passed type checking, behavioral suites and the production build. Running the same tests without process isolation reported all 144 individual tests passing. [Recorded native results](40-i18n.json) contain:

| Workflow | Passing checks |
| --- | ---: |
| Chinese browser/interface acceptance | 32 |
| English Settings regression | 38 |
| English retained-session regression | 24 |
| English reading and passage regression | 50 |
| Retained/hostile dictionary rendering | 11 |
| Chinese Orca speech | 8 |
| English Orca speech | 8 |

Chinese acceptance used the actual Edge `zh-CN` browser UI locale. It verified initial automatic selection, explicit English and Chinese overrides, restoration of Browser default, Chinese branding/metadata/accessibility names, grammar labels with unchanged values, two expanded articles, source and panel scroll, dirty provider drafts and site input, a lookup in flight, failed durable saves, retained validation notices, passage focus and labels, worker restart, and browser restart. Native keyboard selection caught and fixed a focus loss caused by temporarily disabling the selector during saving. Screenshots also prompted immediate relocalization of an existing save-status region, cancelling its obsolete queued text.

The browser test checks configuration and result equality and provider call counts around locale saves: interface changes neither create nor cancel lookup requests. Settings and session regressions deliberately use English disposable browser locales, independent of the desktop language. The new Chinese workflow uses a Chinese disposable profile and browser UI. All windows ran on isolated Xvfb displays; no user profile or shared-desktop windows were used.

Orca ran on private session/accessibility buses through `silent_speech.py`, using a private dispatcher and temporary silent output. Both languages produced actual dictionary resolution, distinguishable article-completion, analysis-error, unsaved-draft and saved-settings speech events. This verifies native events observed by Orca, not physical audibility, pronunciation quality or shared KDE behavior. The user's audio routing and volume settings were preserved.

Provider payloads were controlled or retained fixtures. These tests establish interface behavior and preservation of supplied content; they do not establish new live provider capabilities or Chinese dictionary explanations. Unknown legacy notices use localized generic recovery text in Chinese; records with structured grammar retain translated field labels.

## Reproduce

```sh
npm run check
node --experimental-strip-types --test --test-isolation=none tests/*.test.ts
npm run build:controlled
python3 tests/native/settings_workflow.py --output /tmp/tensho-settings
python3 tests/native/reading_workflow.py --passage
python3 tests/native/dictionary_render.py --output /tmp/tensho-dictionary-render
node scripts/build.mjs --recovery
python3 tests/native/session_workflow.py --output /tmp/tensho-session
python3 tests/native/session_workflow.py --i18n --output /tmp/tensho-i18n
python3 tests/native/silent_speech.py -- python3 tests/native/orca_workflow.py \
  --runtime /tmp/tensho-orca-runtime/usr --i18n --output /tmp/tensho-orca-chinese
python3 tests/native/silent_speech.py -- python3 tests/native/orca_workflow.py \
  --runtime /tmp/tensho-orca-runtime/usr --output /tmp/tensho-orca-english
```
