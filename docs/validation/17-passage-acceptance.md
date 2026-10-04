# Passage word selection acceptance

Ticket [#17](https://github.com/YoukouTenhouin/Tensho/issues/17) adds retained Latin passages with explicit individual-word lookup. Validation on 2026-10-04 used Node 24.18.1, npm 11.16.0, and Microsoft Edge 154.0.4258.37. Native browser tests ran on isolated Xvfb, leaving the shared desktop monitors available.

## Delivered behavior

A multiword selection retains the original selected text and offers word buttons without analysis or batch requests. Choosing a word invokes the existing analyzer only for that word. The passage and controls remain visible during loading, success, and failure, including explicit retry. Dictionary work continues beneath the chosen word's analysis. A new selection replaces the passage.

Word offering splits at whitespace and punctuation boundaries, preserving letters, numbers, combining marks, internal apostrophes, ordinary/Unicode hyphens, and enclitics such as `virumque`. It neither segments enclitics nor applies linguistic inference. Offered words retain exact source slices, including decomposed spelling and non-BMP characters. Provider query preparation may apply canonical normalization; original passage and offered spelling remain separate. Browser selection APIs can reflect rendered whitespace rather than raw DOM text; the extension retains the exact selection string it receives.

The full selection is validated before requests: at most 4,096 Unicode code points, 256 code points in every offered word, and 256 offered words. Empty, punctuation-only, and oversized input issues no request. Invalid input is explained without silently truncating it. Original input remains available in the notice state. Latin lookup and English explanations remain visible throughout.

Each word lookup has a new generation while the passage identity remains stable. Rapid choices replace the current target during loading, and late responses cannot replace newer work. Passage intent is validated without cancelling current work; only a still-current choice that passes active-tab and source-identity checks can start a lookup. Stale buttons from a superseded passage cannot cancel a newer request.

Word controls are native buttons with meaningful position-aware names, visible keyboard focus, and selected-state announcements. They remain mounted across word-result changes, preserving focus. Manual input accepts multiple lines: Enter submits, Shift+Enter inserts a newline, and composition input is respected.

## Evidence

- `npm run check`: **58 behavioral tests pass**, with type checking and production build. Passage tests cover zero automatic requests; punctuation, combining marks, macrons, apostrophes, hyphens, enclitics, repeated words, and non-BMP characters; exact and one-over limits; original source slices; loading/failure/retry retention; reordered provider completion; stale, invalid, and deferred choices; source/configuration identity changes; and canonical normalization through the production Whitaker adapter.
- [Native passage evidence](17-native-passage.json): **49 checks pass**, including the existing native reading regression. Actual Edge selection capture is followed by native Tab/Enter word choices with visible focus, exact chosen-word call accounting, rapid choices, controlled failure and native retry, retained controls, and invalid-input rejection. The test-only controlled adapter records calls and provides one explicit failure case; these hooks are not included in `dist`. A stale passage message sent while a new `cano` lookup is loading does not cancel it.
- [Live passage evidence](17-live-passage.json): **18 checks pass** with the unmodified production extension. Native permission denial/grant is exercised; opening `“important,” mālum` sends no automatic request. Selecting `important` uses live Latin Whitaker analysis and preserves the passage. Revoked analysis access causes a local error and explicit retry without another guarded request or loss of controls. The live provider receives only the selected word, not the passage.
- A clean `npm ci --offline` followed by `npm run check` reproduced all **nine production build artifact hashes** exactly. Dependencies remain pinned.

The live run preceded the stale-action ordering correction; the final correction was exercised through production core tests and the actual Edge dispatch regression. The controlled runner proves the native reading path; the live runner separately proves provider integration. Neither claims worker-idle restoration or the later bounded session-retention gates.

## Standards

Read-only review of `94e73fbf448fbc057aa25bfd5e5a8afb576956dc...c2fc40b81970033bd951c4e22b4e06f03c7b5933` found **zero documented-standard violations and zero new maintainability findings**. Input preparation and coordination remain independent of browser APIs under ADR 0006. A second review of the correction through `6acd709da3a83df348d8d5951197e6a901545866` also found no violations or meaningful new smells. Intent reservation addresses an observed ordering defect, and shared identity comparison avoids divergent validation rules.

## Spec

The initial independent review identified one defect: a stale passage message could cancel a newer lookup before rejection, leaving it loading. The correction validates the passage/index before any cancellation, preserves deferred intent order, and verifies active tab/source identity before starting. Core and native regression tests reproduce the original scenario. Follow-up review confirmed the finding resolved and found no remaining concrete defects.

Final review totals: Standards **0 hard violations / 0 new maintainability findings**; Spec **0 unresolved findings**.

Sanskrit sandhi segmentation remains outside this ticket and the autonomous implementation goal's research scope. Bounded session storage and interruption recovery remain in their designated later tickets.
