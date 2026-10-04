# Latin delivery acceptance

Ticket [#27](https://github.com/YoukouTenhouin/Tensho/issues/27) assembles the Latin implementation against the [parent specification](https://github.com/YoukouTenhouin/Tensho/issues/13). Delivery is still pending the current KDE keyboard workflow and full Orca attempt. Passing isolated browser checks does not waive either requirement.

## Current verification

On 2026-10-04, `npm run check` passed all 134 behavioral tests, TypeScript checking, and the production build. A fresh `git archive HEAD` checkout followed by `npm ci --offline` and `npm run check` reproduced all nine production artifacts byte for byte. [Build evidence](27-build-reproduction.json) identifies the source commit, runtime versions and hashes.

The production extractor and renderer passed all 10 checks in actual headless Edge 154.0.4258.37. [Rendering evidence](27-dictionary-render.json) covers all retained complete article text, hostile markup, inert links, attribution, multiple articles, and distinct failure outcomes. These are controlled responses through production modules, not live provider observations.

The new `session_workflow.py --accessibility` scenario passed 15 checks in Edge on isolated Xvfb. All learner actions use native XTest keyboard input; CDP observes state, reads Edge's accessibility tree, and selects controlled provider outcomes. [Keyboard evidence](27-native-accessibility.json) covers labelled input and result landmarks, visible focus, live analysis loading/error semantics, passage-word names and selection, dictionary expansion, multiple full articles, focus retention when article buttons are replaced, leaving the results, explicit retry, and Escape restoration without page scrolling. It does not establish spoken announcements or KDE/Orca integration.

## Parent acceptance trace

Every Latin acceptance row is listed below. Linked earlier-ticket browser evidence describes its recorded build; current behavioral tests revalidate the production contracts. The remaining desktop gap is explicit rather than inferred from earlier passing runs.

| Parent area | Evidence and scope |
| --- | --- |
| Installation | [Current build reproduction](27-build-reproduction.json); [README](../../README.md) installation, update and separate access setup; [native settings](26-native-settings.json) defaults and browser-restart persistence; [live access](25-live-dictionary.json) no provider calls before an explicit lookup. |
| Native interaction | [49 reading checks](26-native-reading.json) double-click, dragging, editables, manual/keyboard input, frames and passage choices; [optional access](14-optional-access.json) actual context menu and temporary access. Current KDE keyboard rerun remains pending. |
| Focus and panel | [Reading checks](26-native-reading.json) accepted opening focus, updates preserving page focus, two-press toggle, missing source, close/Escape and closed-panel completion; [current keyboard checks](27-native-accessibility.json) no trap and article focus retention. [ADRs 0010](../adr/0010-native-sidebar-opening-focus.md) and [0011](../adr/0011-native-sidebar-keyboard-toggle.md) define the accepted native behavior. Current KDE rerun remains pending. |
| Tabs and navigation | [Native session](26-native-session.json) independent tabs, retained content/scroll, manual reopen, same-document navigation, replacement and browser restart; `reading-session.test.ts`, `lookup.test.ts`, and `reading-record.test.ts` check identity and hydration races. |
| Input | `passage.test.ts` and `latin-lookup.test.ts` exercise exact and one-over code-point, offered-word and count limits through production coordination, Unicode connectors and original selection; [reading checks](26-native-reading.json) zero automatic passage analysis and explicit word choice. |
| Language isolation | [Live dictionary](25-live-dictionary.json) Latin `important` → `importo`; `provider-router.test.ts` covers explanation-compatible and structural-only routes without cross-language substitution; `whitaker.test.ts` excludes explicitly foreign analyses. |
| Settings | [Native consistency](26-native-consistency.json) visible refresh, deferred hidden work, worker restart and word scroll reset; [native settings](26-native-settings.json) all-disabled, unavailable preferences and persisted choices; `configuration.test.ts` and `provider-router.test.ts` cover supported replacements, options and stale generations. |
| Analysis ambiguity | `whitaker.test.ts` and `latin-lookup.test.ts` run all seven retained responses, including `legi`, `malum` and `mālum`, through normalization/coordination; preserve supplied boundaries, meanings, provenance and unknown identities. |
| Resolver | `latin-index.test.ts` covers actual exact-root and numbered siblings, encounter order, provenance, duplicate IDs, singleton uncertainty and unresolved misses; [live dictionary](25-live-dictionary.json) exercises explicit alternatives without automatic article selection. |
| Lazy retrieval | `dictionary.test.ts` and `dictionary-recovery.test.ts` cover lazy resolution, explicit retrieval, concurrent choices and pre-/post-success fallback; [native recovery](23-native-recovery.json) exposes these states in Edge; [current keyboard run](27-native-accessibility.json) opens two full articles. |
| Failure taxonomy | `provider-router.test.ts`, `provider-recovery.test.ts`, `dictionary-recovery.test.ts`, `reading-record.test.ts` and `reading-session.test.ts`; [native recovery](23-native-recovery.json) controlled absence, mapping, failure, permission and deadline outcomes. Controlled confirmed absence is not a live dictionary no-entry claim. |
| Fallback | `provider-recovery.test.ts` and `dictionary-recovery.test.ts` cover one attempt, eligibility, partial success, local retry and distinct deadline stops; [native recovery](23-native-recovery.json) preserves earlier reasons and does not query the untouched third provider after the real deadline. |
| Permissions | [Native permission scope](14-permission-scope.json) scheme, hostname and port isolation; [optional access](14-optional-access.json) actual grant/denial, context menu and temporary access; [site revocation](25-native-site-revocation.json) no unauthorized frame capture; [live access](25-live-dictionary.json) guarded provider calls before/after grant and revocation. |
| Races and restart | [Native lifecycle](25-native-lifecycle.json), [site revocation](25-native-site-revocation.json), [consistency](26-native-consistency.json) and [session](26-native-session.json) exercise actual worker termination, completed retention, explicit interrupted retry, delayed results and capture races; corresponding coordination/session tests revalidate the contracts. |
| Parser and renderer | [Current production rendering checks](27-dictionary-render.json); `latin-article.test.ts` checks retained complete prose/quotes, identity, malformed and oversized data; `latin-index.test.ts` checks bounded decoding. Provider elements and active attributes are never adopted. |
| Bounds and cache | `requests.test.ts`, `provider-recovery.test.ts` and `dictionary-recovery.test.ts` cover shared concurrency, cancellation, request/action deadlines and streamed bounds. `session-results.test.ts`, `reading-session.test.ts` and `session-storage.test.ts` cover exact serialized 6 MiB, inactive eviction, insufficient room and quota errors. `latin-index.test.ts` covers fresh/expired/malformed caches and failed refresh without stale fallback. [Native recovery](23-native-recovery.json) observes the real 30-second deadline; [native session](26-native-session.json) checks storage and source-link recovery. |
| Accessibility | [Current native keyboard and AX checks](27-native-accessibility.json) pass on isolated Xvfb. Actual KDE keyboard completion and the full Orca attempt remain pending. Live-region semantics alone do not prove screen-reader speech. |

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
| 58 | Accessibility, Focus and panel; desktop and Orca evidence pending |
| 59–64 | Gated Sanskrit follow-on, outside this Latin delivery and autonomous non-research scope |

## Remaining release checks

The shared-desktop test runner now contains its disposable windows within HDMI-A-1 and verifies placement before native input. Current KDE attempts reached the page and opened the sidebar, but XTest keys did not reach the focused test page. The Wayland-native sharing picker timed out twice without a selected monitor. These are incomplete desktop automation attempts, not proof of an extension defect or a passing native acceptance run.

Orca 50.3 and its runtime dependencies were extracted under `/tmp` without installing system packages. Its version command reports AT-SPI2 2.60.7, Wayland KDE, and a missing `org.freedesktop.a11y.PointerLocator` interface warning. A version command is not a full workflow attempt; the Orca release requirement remains open.
