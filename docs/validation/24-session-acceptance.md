# Retained reading session acceptance

Ticket [#24](https://github.com/YoukouTenhouin/Tensho/issues/24) retains one current reading result per tab across sidebar closure and worker restart. Validation on 2026-10-04 used Microsoft Edge 154.0.4258.37 on isolated Xvfb displays, with Node 24.18.1 and npm 11.16.0.

## Delivered behavior

Browser-session storage contains completed analysis, dictionary alternatives and articles, expansion state, original passage context, and panel scroll. Hydration validates rendering shapes, safe source links, candidate/article associations, and current document/configuration identity. It makes no provider requests. Interrupted pieces require explicit retry. Only extension contexts can read the session collection; page scripts cannot read it.

The actual UTF-8 JSON representation, including its storage envelope, is bounded to 6 MiB. This budget is separate from decoded response limits and the persistent dictionary index. Least recently viewed inactive results are evicted first, retaining an explicit revisit notice. Failed additions roll back tentative eviction. An article that cannot fit becomes a resource notice with a validated source link; completed articles and other retained results survive. The article is never silently truncated or labelled dictionary absence.

A replacement selection durably invalidates its predecessor before dispatch. If storage cannot clear that predecessor, the new lookup is refused visibly and the current completed reading state stays usable. Reserved newer actions and tab activation take precedence over an older eviction write. Navigation and reload clear reading state; same-document navigation retains it. Browser restart clears session text/results while local settings and site enablement survive.

Panel activation clears the previous tab's displayed result before asynchronous restoration. Closing the sidebar does not cancel useful pending completion or cause it to reopen later. Native visibility remains separate from retained content: explicit toolbar/keyboard reopening is supported when Edge does not restore its sidebar on tab changes. The accepted native toggle policy remains unchanged. Restoring panel scroll and focus does not deliberately move the source page.

## Evidence

- `npm run check`: **118 behavioral tests pass**, plus typechecking and build. Production coordinator/session-adapter tests cover independent tabs, expansion, scroll, passage context, identity validation, stale hydration, exact serialized limits, Unicode/escaping overhead, LRU eviction, quota and storage failures, atomic failed additions, replacement invalidation, queued updates, and newer active intents during eviction. Refused replacements preserve completed dictionary state and leave interrupted work retryable.
- [Native session evidence](24-native-session.json): **24 checks pass**. Actual Edge worker termination restores completed state without calls. Native close/reopen retains content, expansion, and scroll; tabs remain independent. Content scripts cannot read the collection. Same-document navigation retains results, while reload and a different document clear them. Pending completion stays closed. Browser restart clears results and preserves settings/site enablement. A synthetic oversized article exercises resource handling independently of provider decoded-response limits.
- [Live Latin and dictionary evidence](24-live-dictionary.json): **27 checks pass** using the unmodified production build. Actual Whitaker analysis and a complete Lewis & Short article are retained in session storage. Native denial/grant, explicit lookup, article choice, attribution, safe links, serialized bounds, index-only persistent caching, and guarded revocation/retry checks pass.
- [Native reading evidence](24-native-reading.json): **49 checks pass** for reading, focus, selection, and passage regressions. [Native settings evidence](24-native-settings.json): **20 checks pass**, including full browser restart.
- [Build reproduction](24-build-reproduction.json): a clean `npm ci --offline` and `npm run check` reproduces all **nine production artifact hashes**.

The native session profile explicitly enables Developer mode, matching the unpacked-install guide. An earlier test profile omitted it; Edge marked the temporary extension unsupported at restart. The corrected full run passes without changing production extension behavior. All native windows ran on isolated displays, leaving the user's monitors available.

## Standards

Independent review through `dad29b3` found **zero documented-standard violations and zero new maintainability findings**.

## Spec

Independent review found **zero remaining spec findings** after fixing replacement-save resurrection, eviction of newer active intents, and dictionary loss on refused replacement. Regression tests cover those paths, including non-query notices and interrupted prior analysis. Further permission-revocation and interruption acceptance continues in #25; cross-tab result reuse continues in #26.

Final review totals: Standards **0 violations / 0 new findings**; Spec **0 unresolved findings**.
