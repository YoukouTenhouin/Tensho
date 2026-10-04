# Cross tab settings consistency acceptance

Ticket [#26](https://github.com/YoukouTenhouin/Tensho/issues/26) refreshes the visible selection after settings changes and defers hidden results until viewed. Verification used Edge 154.0.4258.37 on isolated Xvfb displays on 2026-10-04.

## Behavior

Configuration changes invalidate analysis and dictionary generations across tabs. A hidden result retains only its current input and passage context, marked explicitly for refresh on viewing; obsolete provider output is removed. Opening its results validates current source identity and refreshes once under the new configuration. Repeated views reuse completed current work, while a newer selection or settings change supersedes the deferred intent.

The marker is validated and retained in bounded browser-session storage. Worker reconstruction does not fetch hidden results. Consuming the marker first persists unfinished work: interruption during asynchronous source validation restores Interrupted with explicit Retry. Eviction remains a separate cleared notice and never recreates hidden history. Unchosen passages do not query automatically.

Result scroll follows lookup generation. Choosing another passage word resets scroll while preserving the original passage and word controls. Reopening the same retained result restores its saved position. Configuration, language, tab, document, candidate and article guards continue to reject stale analysis and dictionary completions. Disabled or unsupported configurations retain explicit language preferences without ineligible requests.

## Evidence

- `npm run check`: **134 behavioral tests pass**, plus typechecking and production build. Added tests cover repeated view races, chosen passage context, hydration without replay, superseding input, settings changes during delayed index/article work, old panel actions, session persistence, eviction of deferred input, interruption during deferred handoff, and per-word scroll reset. Existing delayed analysis, provider options, explanation routing, unavailable language, and generation tests remain passing.
- [Native consistency](26-native-consistency.json): **14 checks pass**. Provider reorder refreshes only the visible tab; hidden work refreshes upon viewing. Switching current tabs does not repeat requests. All-disabled settings make no calls. An actual Edge worker stop preserves deferred refresh without replay. A long article followed by another passage word resets scroll and preserves the passage controls. Retained state remains within the 6 MiB session budget.
- [Native session](26-native-session.json): **24 checks pass** for independent tab results, close/reopen, worker and browser restart, source focus/scroll, document invalidation, resource retention, and closed-panel completion.
- [Native settings](26-native-settings.json): **20 checks pass** for visible language/explanation states, unavailable and disabled configurations, shared preferences, and full browser restart.
- [Native reading](26-native-reading.json): **49 checks pass** for selection routes, frames, focus, passage choices, delayed completion, and native shortcuts after the final scroll changes.

Native providers are controlled build-time fixtures; browser coordination, settings, session storage, routing, and UI are production code. Session and settings runs preceded the final handoff/scroll review fixes; behavioral and native consistency/reading checks cover those final changes. Live provider integration remains separately recorded in [ticket 25 acceptance](25-recovery-acceptance.md).

## Standards

Independent review found zero documented-standard violations and zero new maintainability findings. The consistency scenario reuses the disposable session runner.

## Spec

Independent review found no remaining concrete defects after fixing interrupted deferred handoff and passage-word scroll reset. Both have behavioral regressions; native Edge additionally verifies scroll reset.
