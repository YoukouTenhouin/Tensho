# Latin delivery acceptance

Ticket [#27](https://github.com/YoukouTenhouin/Tensho/issues/27) assembles the Latin implementation against the [parent specification](https://github.com/YoukouTenhouin/Tensho/issues/13). The assembled Latin implementation passes the KDE keyboard workflow and the isolated Orca speech workflow. Native desktop and isolated speech evidence have separate scopes below.

## Current verification

On 2026-10-05, `npm run check` passed all 136 behavioral tests, TypeScript checking, and the production build. A fresh `git archive HEAD` checkout followed by `npm ci --offline` and `npm run check` reproduced all nine production artifacts byte for byte. [Build evidence](27-build-reproduction.json) identifies the source commit, runtime versions and hashes.

The production extractor and renderer passed all 10 checks in actual headless Edge 154.0.4258.37. [Rendering evidence](27-dictionary-render.json) covers all retained complete article text, hostile markup, inert links, attribution, multiple articles, and distinct failure outcomes. These are controlled responses through production modules, not live provider observations.

The new `session_workflow.py --accessibility` scenario passed 22 checks in Edge on isolated Xvfb. All learner actions use native XTest keyboard input; CDP observes state, reads Edge's accessibility tree, and selects controlled provider outcomes. [Keyboard evidence](27-native-accessibility.json) covers labelled input and result landmarks, visible focus, live analysis loading/error semantics, passage-word names and selection, dictionary expansion, multiple full articles, focus retention when article buttons are replaced, leaving the results, explicit retry, and Escape restoration without page scrolling. It does not establish spoken announcements or KDE/Orca integration.

## Parent acceptance trace

Every Latin acceptance row is listed below. Linked earlier-ticket browser evidence describes its recorded build; current behavioral tests revalidate the production contracts. Current KDE and isolated Orca runs are linked separately.

| Parent area | Evidence and scope |
| --- | --- |
| Installation | [Current build reproduction](27-build-reproduction.json); [README](../../README.md) installation, update and separate access setup; [current native settings](27-native-settings.json) defaults and browser-restart persistence; [live access](25-live-dictionary.json) no provider calls before an explicit lookup. |
| Native interaction | [49 reading checks](26-native-reading.json) double-click, dragging, editables, manual/keyboard input, frames and passage choices; [optional access](14-optional-access.json) actual context menu and temporary access. [Current KDE reading and passage run](27-native-reading-kde.json) passes all 49 checks. |
| Focus and panel | [Reading checks](26-native-reading.json) accepted opening focus, updates preserving page focus, two-press toggle, missing source, close/Escape and closed-panel completion; [current keyboard checks](27-native-accessibility.json) no trap and article focus retention. [ADRs 0010](../adr/0010-native-sidebar-opening-focus.md) and [0011](../adr/0011-native-sidebar-keyboard-toggle.md) define the accepted native behavior. [Current KDE reading and passage run](27-native-reading-kde.json) passes all 49 checks. |
| Tabs and navigation | [Native session](26-native-session.json) independent tabs, retained content/scroll, manual reopen, same-document navigation, replacement and browser restart; `reading-session.test.ts`, `lookup.test.ts`, and `reading-record.test.ts` check identity and hydration races. |
| Input | `passage.test.ts` and `latin-lookup.test.ts` exercise exact and one-over code-point, offered-word and count limits through production coordination, Unicode connectors and original selection; [reading checks](26-native-reading.json) zero automatic passage analysis and explicit word choice. |
| Language isolation | [Live dictionary](25-live-dictionary.json) Latin `important` → `importo`; `provider-router.test.ts` covers explanation-compatible and structural-only routes without cross-language substitution; `whitaker.test.ts` excludes explicitly foreign analyses. |
| Settings | [Native consistency](26-native-consistency.json) visible refresh, deferred hidden work, worker restart and word scroll reset; [current native settings](27-native-settings.json) all-disabled, unavailable preferences and persisted choices; `configuration.test.ts` and `provider-router.test.ts` cover supported replacements, options and stale generations. |
| Analysis ambiguity | `whitaker.test.ts` and `latin-lookup.test.ts` run all seven retained responses, including `legi`, `malum` and `mālum`, through normalization/coordination; preserve supplied boundaries, meanings, provenance and unknown identities. |
| Resolver | `latin-index.test.ts` covers actual exact-root and numbered siblings, encounter order, provenance, duplicate IDs, singleton uncertainty and unresolved misses; [live dictionary](25-live-dictionary.json) exercises explicit alternatives without automatic article selection. |
| Lazy retrieval | `dictionary.test.ts` and `dictionary-recovery.test.ts` cover lazy resolution, explicit retrieval, concurrent choices and pre-/post-success fallback; [native recovery](23-native-recovery.json) exposes these states in Edge; [current keyboard run](27-native-accessibility.json) opens two full articles. |
| Failure taxonomy | `provider-router.test.ts`, `provider-recovery.test.ts`, `dictionary-recovery.test.ts`, `reading-record.test.ts` and `reading-session.test.ts`; [native recovery](23-native-recovery.json) controlled absence, mapping, failure, permission and deadline outcomes. Controlled confirmed absence is not a live dictionary no-entry claim. |
| Fallback | `provider-recovery.test.ts` and `dictionary-recovery.test.ts` cover one attempt, eligibility, partial success, local retry and distinct deadline stops; [native recovery](23-native-recovery.json) preserves earlier reasons and does not query the untouched third provider after the real deadline. |
| Permissions | [Native permission scope](14-permission-scope.json) scheme, hostname and port isolation; [optional access](14-optional-access.json) actual grant/denial, context menu and temporary access; [site revocation](25-native-site-revocation.json) no unauthorized frame capture; [live access](25-live-dictionary.json) guarded provider calls before/after grant and revocation. |
| Races and restart | [Native lifecycle](25-native-lifecycle.json), [site revocation](25-native-site-revocation.json), [consistency](26-native-consistency.json) and [session](26-native-session.json) exercise actual worker termination, completed retention, explicit interrupted retry, delayed results and capture races; corresponding coordination/session tests revalidate the contracts. |
| Parser and renderer | [Current production rendering checks](27-dictionary-render.json); `latin-article.test.ts` checks retained complete prose/quotes, identity, malformed and oversized data; `latin-index.test.ts` checks bounded decoding. Provider elements and active attributes are never adopted. |
| Bounds and cache | `requests.test.ts`, `provider-recovery.test.ts` and `dictionary-recovery.test.ts` cover shared concurrency, cancellation, request/action deadlines and streamed bounds. `session-results.test.ts`, `reading-session.test.ts` and `session-storage.test.ts` cover exact serialized 6 MiB, inactive eviction, insufficient room and quota errors. `latin-index.test.ts` covers fresh/expired/malformed caches and failed refresh without stale fallback. [Native recovery](23-native-recovery.json) observes the real 30-second deadline; [native session](26-native-session.json) checks storage and source-link recovery. |
| Accessibility | [Current native keyboard and AX checks](27-native-accessibility.json) pass on isolated Xvfb. The [KDE Orca attempt](27-orca-attempt.json) found announcement defects which were fixed. The [isolated Orca workflow](27-orca-isolated.json) records actual speech API output for loading, completion, errors, dictionary alternatives, two articles, and settings changes. [Current KDE keyboard coverage](27-native-reading-kde.json) passes. This is not a claim of fully validated Orca/KDE integration or physical audibility. |

## User story coverage

This maps every Latin story to the acceptance areas above without treating the Sanskrit follow-on as delivered.

| Stories | Acceptance areas |
| --- | --- |
| 1–2 | Installation |
| 3–10 | Native interaction, Input, Permissions |
| 11–14 | Focus and panel |
| 15–18 | Focus and panel, Tabs and navigation, Races and restart |
| 19 | Bounds and cache |
| 20–22 | Input |
| 23–25 | Language isolation, Failure taxonomy |
| 26–33 | Settings, Language isolation |
| 34 | Races and restart |
| 35–37 | Analysis ambiguity |
| 38 | Analysis ambiguity, Parser and renderer |
| 39–43 | Resolver, Lazy retrieval |
| 44–45 | Parser and renderer |
| 46–50 | Lazy retrieval, Failure taxonomy, Fallback |
| 51–52 | Permissions, Races and restart |
| 53–54 | Races and restart, Tabs and navigation |
| 55 | `latin-lookup.test.ts` inspects production request text/normalization; production adapters send only requested text and required service parameters. No surrounding page content is included. |
| 56–57 | Bounds and cache |
| 58 | Accessibility, Focus and panel; KDE keyboard and isolated Orca speech coverage pass with the environment distinction above |
| 59–64 | Gated Sanskrit follow-on, outside this Latin delivery and autonomous non-research scope |

## Native and speech results

The final [49-check KDE reading run](27-native-reading-kde.json) uses Edge 154.0.4258.37 on Plasma/KWin 6.7.5, Wayland with Xwayland input. Its disposable window is contained within HDMI-A-1 and placement is checked before input. It verifies actual shortcuts, frame routing, passage controls, focus restoration and closed-panel behavior. The loading-announcement scenario holds its controlled request pending and waits for the new lookup's completion; matching a previous status string is insufficient. The [22-check keyboard accessibility run](27-native-accessibility.json) and [20-check settings run](27-native-settings.json) use isolated Xvfb. Settings restart follows the documented developer-mode installation setup.

The [original KDE Orca attempt](27-orca-attempt.json) ran the full controlled reading sequence through the actual sidebar. Orca 50.3 and dependencies were extracted under `/tmp`, without installing system packages. Browser-process-scoped recorders and memory-backed preferences avoided recording unrelated applications or changing the user's preferences. Accessibility flags were restored. These target-environment attempts exposed two extension interoperability defects: Orca classified `role=status` text as UI updates, and result rendering generated text-event bursts that suppressed subsequent announcements. Explicit polite atomic regions and deferred, coalesced updates address those defects. Pending dictionary messages are cancelled on selection change and when provider fallback discards their articles; regression tests cover both cases.

Shared-desktop speech runs could also lose Orca's active application when desktop focus changed. To separate that external interaction from extension behavior, the retained `tests/native/orca_workflow.py` starts isolated Xvfb, a private session bus, a private accessibility bus and registry, and Orca. Explicit registry startup avoids this KDE installation's failed service activation in a private session. Run it through `tests/native/silent_speech.py` so speech uses a private dispatcher and temporary silent sink, preserving normal desktop audio. The runtime prefix and output directory are explicit arguments; build `dist-recovery` first with `node scripts/build.mjs --recovery`.

The [final isolated Orca evidence](27-orca-isolated.json) records actual speech API output: analysis loading/completion, dictionary alternatives with uncertainty, both full article completions, analysis failure and retry completion, and unsaved/saved settings. It drives controls through CDP and observes real native AT-SPI events; the separate native keyboard suite supplies keyboard evidence. It does not establish physical audibility, pronunciation quality, or uninterrupted speech under arbitrary shared-desktop focus changes. Earlier diagnostic artifacts remain historical failures, not final acceptance claims. Fallback-provider details remain readable normal content alongside concise status announcements.

## Standards

Final review found no documented-standard violations. One nonblocking maintainability suggestion remains: dictionary outcome wording is interpreted separately by the visible dictionary view and its announcement summary. Their different presentation needs are intentional; pending state and cancellation are kept in the announcement module.

## Spec

Review identified a stale queued article announcement during candidate-local fallback. The fix removes messages absent from the current snapshot and cancels empty pending batches. A regression fails against the earlier implementation and passes with the fix. All Latin acceptance areas above have behavioral or recorded browser evidence; Sanskrit stories 59–64 remain gated and excluded.

Review totals: Standards — zero hard violations, one maintainability suggestion; Spec — one correctness finding fixed and regression-tested.
