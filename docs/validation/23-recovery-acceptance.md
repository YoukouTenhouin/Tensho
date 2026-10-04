# Eligible provider recovery acceptance

Ticket [#23](https://github.com/YoukouTenhouin/Tensho/issues/23) adds ordered recovery for technical provider failures. Validation on 2026-10-04 used Node 24.18.1, npm 11.16.0, and Microsoft Edge 154.0.4258.37. Native tests ran on isolated Xvfb displays.

## Delivered behavior

Each role starts with its configured lookup-language and explanation route. Disabled and incompatible providers are excluded; supported input and existing access are checked before dispatch. Missing access is explicit and never triggers a permission prompt. Network, HTTP, format, identity, decoded-size, and request-timeout failures advance to the next eligible provider, with one attempt per failed operation. No-match, confirmed dictionary absence, unresolved mapping, and usable partial results stop the chain. Analysis never switches to a structural-only route after a preferred-route failure.

Dictionary resolution returns alternatives for explicit learner choice. If the chosen article fails technically before any article for that candidate succeeds, recovery offers the next dictionary's alternatives without selecting an article. Once an article succeeds, later failures and retries stay local to that provider and preserve the successful article. Choices are serialized within a candidate so first success and subsequent failure have a consistent order; other candidates remain independent. Provider identity accompanies article actions, rejecting stale buttons even when two dictionaries reuse an entry identifier. Dictionary work never reruns or replaces analysis.

Failure history and actual provider provenance remain visible on recovery and exhaustion. Shared request slots, 15-second request limits, and a 30-second action deadline apply across queueing and fallback. The action deadline includes queued candidate choices. Deadline stops preserve prior failure reasons without saying that untouched providers failed. Explicit retry starts a new bounded action under current settings.

Only the existing validated Latin integrations ship. The separate `--recovery` build supplies controlled declarations and adapters through the integrated-provider registry; production coordination, routing, permissions checks, executor, settings and sidebar UI remain in use. Fixture sources are typechecked and excluded from the production build.

## Evidence

- `npm run check`: **92 behavioral tests pass**, plus typechecking and production build. Recovery tests cover all technical failure classes; no-match and partial success; explanation/language, enablement, input and permission exclusion; one-attempt behavior; local retries; candidate identity; pre-/post-article-success failure; concurrent choices; stale provider buttons; deadline history and ignored late completion. Shared executor tests retain the two-request bound even when timed-out work ignores cancellation.
- [Native recovery evidence](23-native-recovery.json): **24 checks pass** through the actual Edge sidebar. Native Enter activates retries and article choices. Warnings, earlier reasons, uncertainty, retained analysis, embedded quotations, disabled/ungranted skipping, terminal absence/mapping outcomes, and pre-/post-success article recovery are visible. The real action stops after approximately **30.01 seconds**, following the first 15-second request timeout, without querying a third dictionary.
- [Live dictionary evidence](23-live-dictionary.json): **25 checks pass** with the production extension, including native permission denial/grant, Latin `important` → `importo`, explicit Lewis & Short article choice, full article/source/credits, index-only caching, settings without reading results, and local retry after revocation without guarded requests.
- [Native reading evidence](23-native-reading.json): **49 checks pass** for the existing reading and passage workflow after the provider-registry extraction.
- A clean `npm ci --offline` followed by `npm run check` reproduces all **nine production artifact hashes**. A production bundle inspection confirms recovery fixture hooks are absent.

The first recovery run exposed inconsistent deadline wording between the request executor and chain timer. The final recovery run verifies their common explanation. The live dictionary runner's previous storage whitelist predated #20's persistent settings; its updated assertion explicitly permits settings while checking that reading results are absent. The final live run passes that assertion.

Controlled absence and additional providers demonstrate the recovery contract; they do not establish live no-entry semantics or validate extra production integrations. Worker interruption/session restoration remains in #24–#25, with cross-tab retained reuse in #26.

## Standards

Independent review through `6003da3` found **zero documented-standard violations**. One nonblocking maintainability suggestion remains: dictionary operations repeatedly pass identity, signal, deadline, optional options and issue observation positionally; a named operation context could simplify these call sites. The shared chain executor and feedback renderer centralize recovery policy and presentation.

## Spec

Independent review found **zero unresolved spec findings**. The final review confirmed the isolated registry, visible terminal outcomes, recovery controls, failure history and real deadline evidence. The subsequently completed live run establishes the production integration checks separately.

Final review totals: Standards **0 hard violations / 1 nonblocking maintainability suggestion**; Spec **0 unresolved findings**.
