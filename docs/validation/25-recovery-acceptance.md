# Worker interruption and permission revocation acceptance

Ticket [#25](https://github.com/YoukouTenhouin/Tensho/issues/25) keeps completed reading usable while interrupted or unauthorized work stops without replay. Validation on 2026-10-04 used Microsoft Edge 154.0.4258.37 on isolated Xvfb displays. No shared-desktop windows were needed.

## Delivered behavior

Worker hydration retains completed analysis, alternatives, and articles. Pending analysis, resolution, and retrieval become Interrupted and require explicit Retry. Retry follows current configuration, eligibility, permissions, identity, deadlines, and the shared two-request executor. Completed sibling articles remain usable.

Backend permission removal rejects affected queued and running executor jobs and signals abort. A transport that ignores abort still owns its concurrency slot until it settles, but cannot publish a late result or trigger fallback. Each adapter checks access before dispatch and after reading its response; provider chains check again before retaining a result. Revocation has a distinct failure kind and stops the chain. Later actions still require current access, including cached-index resolution, refresh, and article retry. Regrant never revives an old request or initiates a lookup.

Previously injected scripts survive site revocation, so automatic double-click messages now carry only the gesture. The worker checks current site access before requesting text from the exact source document. Reading-access revisions invalidate pending capture authorization and prevent old script-sync work from republishing revoked origins. Explicit keyboard capture uses only documents returned by the current authorized injection. Context-menu focus tracking does not read text; the browser already supplies the explicit selection.

An empty gesture preserves existing work. Cancellation during keyboard capture restores completed dictionary usability and makes abandoned analysis explicitly retryable. Newer gestures, explicit lookups, document changes, and configuration changes invalidate older intent. Revocation and late completion do not reopen closed panels; completed reading survives both site and backend revocation.

## Evidence

- `npm run check`: **126 behavioral tests pass**, with typechecking and production build. Production executor tests cover queued cancellation, dispatch races, ignored aborts, preserved slot ownership, unrelated work, and permission-pattern boundaries. Provider-chain tests reject revoked results without fallback. Dictionary tests cover interrupted resolution/article restoration, explicit retry with current access, completed siblings, and revocation between successive operations. Existing operation deadlines, identity, configuration, fallback, session, and cancellation tests remain passing.
- [Native lifecycle evidence](25-native-lifecycle.json): **18 checks pass**. Actual Edge worker termination during analysis, index resolution, and article retrieval produces Interrupted without replay. Explicit retry requests only the required operation. Native denial/grant/revocation are exercised through the production adapters, executor, catalog, session storage, and sidebar. Only response payloads and delay/abort behavior are controlled. Revoking permission rejects a held article; releasing its abort-ignoring response cannot overwrite the failure, replace a completed sibling, or reopen the sidebar. Edge remembers the earlier approval when access is explicitly enabled again; regrant can complete without another native prompt.
- [Native site evidence](25-native-site-revocation.json): **15 checks pass**. Real optional grants and removals cover the top page and a separate-origin embedded frame. Instrumented selection-read counts stay unchanged after revocation, including with the panel closed. A deliberately held successful permission answer is rejected after actual revocation. A held keyboard capture is cancelled on a site-setting change without reading text or disabling retained dictionary actions. Empty native gestures preserve completed reading. These controlled browser-API delays are separate from live network evidence.
- [Native reading evidence](25-native-reading.json): **49 checks pass** for gestures, frame identity, focus restoration, navigation, cancellation, and passage reading after the final capture fixes.
- [Live Latin and dictionary evidence](25-live-dictionary.json): **27 checks pass** against the unmodified production build. Actual Alpheios requests produce Whitaker analysis and a complete Lewis & Short article, with native permission denial/grant/revocation, attribution, safe links, session retention, and blocked unauthorized retry. This live run preceded the final capture-only review fixes; the final reading/site runs cover those changes.

The site probe initially demonstrated actual text reads after revocation despite correctly blocked lookup. The capture changes eliminate those reads. Review also exposed authorization snapshots surviving asynchronous waits and empty gestures suspending existing work; targeted native regressions now cover both. Broader session budget and browser-restart evidence remains in [ticket 24 acceptance](24-session-acceptance.md).

## Standards

Independent review found no documented-standard violations. One nonblocking maintainability concern remains: the new native runners repeat disposable-browser setup already present in earlier runners. Consolidating that test infrastructure is separate from the recovery behavior.

## Spec

Independent review through `ef6dfa3` found no remaining concrete specification defects after the capture-race fixes. Native acceptance confirms the added keyboard recovery path.
