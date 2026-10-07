# Reading interface and separate settings acceptance

Issue: [#38](https://github.com/YoukouTenhouin/Tensho/issues/38). Validated on 2026-10-07 with Microsoft Edge 154.0.4258.37, Node 24.18.1 and isolated Xvfb/headless displays. [Machine-readable checks](38-interface.json) record 236 passing browser checks. `npm run check`, Python compilation of the native runners and `git diff --check` pass.

The sidebar now contains lookup input, compact shared language controls and reading results. Providers, service access, site management and source credits have their own settings tab. The result surface uses headwords, grammar, meanings and learner-selected dictionary entries, with concise outcomes and source links. Instruction paragraphs, repeated uncertainty disclaimers and internal provenance identifiers have been removed. Complete provider-authored articles remain intact.

## Evidence

| Runner | Passed checks | Coverage |
| --- | ---: | --- |
| Settings | 38 | Separate options tab, fragment navigation, profile isolation, save/discard, concurrent edits, immediate preferences, cross-tab and restart persistence, Escape, themes, responsive layout and zoom |
| Dictionary rendering | 11 | Complete retained text, inert provider content, safe links, explicit alternatives and distinct terminal outcomes |
| Reading and passage | 50 | Native selection, exact-origin frame enablement through Settings, manual keyboard input, passage choices, retry and source-focus restoration |
| Provider recovery | 24 | Concise failure states, technical fallback, retained partial results, local retry and real 30-second action deadline |
| Reading sessions | 24 | Articles, expansion and scroll retained across closure, tab switching and worker restart; navigation and browser-restart clearing |
| Cross-tab consistency | 14 | Visible refresh, inactive deferral, restart hydration and stale-result protection |
| Keyboard accessibility | 22 | Named controls, visible focus, native keyboard navigation, live announcements, distinct entries and Escape |
| Orca | 8 | Actual speech API observations for possible entries, two separately numbered articles, errors, settings drafts and successful saves |
| Live Latin and dictionary | 27 | Unmodified production build, native denial/grant, explicit `important` lookup, complete Lewis & Short article, local retry and revocation |
| Worker/permission lifecycle | 18 | Actual worker stops, interrupted-operation retry, native grants, revocation, regrant and rejection of late responses |

The settings runner saves screenshots at native sizes and at 280/480-pixel sidebar and 320/360/1000-pixel settings widths, in light/dark modes and at 200% text size. It also checks actual browser zoom at 200%. Every measured layout remains free of horizontal document scrolling; screenshots were inspected. Visual fixtures are controlled; the separate Latin runner establishes live-provider behavior.

All desktop input used disposable browser profiles on isolated displays. Orca ran through `tests/native/silent_speech.py` with a private dispatcher, temporary silent output and private accessibility bus. This observes real Orca speech events, not physical audio or a new shared KDE acceptance run.

## Regression details

- The sidebar creates a settings tab when none exists and reuses an existing one. This preserves manual reading results even on `about:blank`, which Edge can otherwise replace when opening options.
- Settings messages recognize the options document with section fragments. Reading actions remain restricted to the panel document; global settings actions use revision checks independently of the active tab.
- The current-site action checks both saved enablement and the native grant, so externally revoked access can be enabled again.
- Dictionary entry numbering is shared by headings and announcements. The added behavioral regression test verifies that same-headword entries produce distinct speech and that collapsing cached content does not reannounce completion.
- The analysis region retains its plain `aria-live="polite"` implementation. Adding a status role prevented Orca from presenting error updates in this workflow; removing it restored the spoken error while retaining the concise text.
- Native tests wait for current rendered controls before sending input and follow the added controls when traversing to manual input.

## Reproduce

```sh
npm run check
npm run build:controlled
python3 tests/native/settings_workflow.py --output /tmp/tensho-settings
python3 tests/native/reading_workflow.py --passage
python3 tests/native/dictionary_render.py --output /tmp/tensho-dictionary-render
node scripts/build.mjs --recovery
python3 tests/native/recovery_workflow.py --output /tmp/tensho-recovery
python3 tests/native/session_workflow.py --output /tmp/tensho-session
python3 tests/native/session_workflow.py --consistency --output /tmp/tensho-consistency
python3 tests/native/session_workflow.py --accessibility --output /tmp/tensho-accessibility
python3 tests/native/silent_speech.py -- python3 tests/native/orca_workflow.py \
  --runtime /tmp/tensho-orca-runtime/usr --output /tmp/tensho-orca
python3 tests/native/latin_workflow.py --dictionary --output /tmp/tensho-live
node scripts/build.mjs --lifecycle
python3 tests/native/lifecycle_workflow.py --output /tmp/tensho-lifecycle
```

The live and lifecycle runners pause for inspected native permission-prompt coordinates. Orca requires the documented runtime prefix. Production `dist` is built by `npm run check`; controlled/recovery/lifecycle builds remain separate.
