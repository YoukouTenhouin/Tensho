# Latin provider acceptance for ticket 15

The live build routes explicit Latin lookups through Alpheios-hosted Whitaker, with native provider access separate from reading-site enablement. The adapter preserves supplied candidate boundaries, grammatical data, English short meanings, attribution, and unknown stable identity. Technical failures, missing access, missing information, and valid no-match remain distinct. Granting access never starts a lookup; retry is explicit.

## Validation evidence

A clean locked install, type checking, all 30 behavioral tests, and the production build pass. All nine production artifact hashes match before and after `npm ci --offline && npm run check` on Node 24.18.1/npm 11.16.0. The behavioral suite crosses production lookup coordination and the real normalizer for all seven retained forms: important, puellae, legi, amaverunt, mālum, malum, and zzqxx. Fixture provenance and observation dates are retained in `tests/fixtures/whitaker/evidence.json`.

The shared executor holds at most two provider slots, including operations that ignore abort, and distinguishes the 15-second request limit from the 30-second learner-action deadline including queueing. Streaming checks enforce the 1 MiB decoded response limit before JSON parsing. Tests cover exact and one-over word/response limits, queued cancellation and deadline expiry, missing fields, malformed data, foreign-language exclusion, permission removal while queued, and out-of-order completion. No automatic retry or provider fallback is introduced.

[Native live evidence](15-latin-access.json) records 13 passing checks in Microsoft Edge 154.0.4258.37 on isolated Xvfb on 2026-10-04. The unmodified production build displayed real native Deny/Allow prompts naming only morph.alpheios.net and repos1.alpheios.net. CDP network observation found zero guarded requests during setup, without access, after denial, after revocation, and when retrying after revocation. Granting access sent no request. One explicit retry after granting access sent `important` to Latin Whitaker with JSON requested and truthful `clientId=tensho`; the UI displayed importo, its supplied grammatical interpretation, English short meanings, and Whitaker attribution. The request contained only word, engine, language, and client identity, with an empty referrer. This is a bounded live observation, not a claim of general linguistic accuracy or provider availability.

[Controlled reading evidence](15-controlled-reading.json) records 36 passing native checks in isolated Edge. `npm run build:controlled` writes a separate `dist-controlled` build with a build-time adapter substitution. It exercises reading interactions without provider traffic; the live `dist` build is unchanged. The installation and reproduction commands are in the README. Existing ticket 14 evidence retains its original environment and scope.

## Standards

No documented-standard violations found in `da009c9..6d34025`. The changes preserve candidate boundaries and unknown stable identity under ADR 0005, browser/core separation under ADR 0006, and the English explanation and grammatical-label policy under ADR 0002.

Two nonblocking judgment calls remain: provider access is represented by positional booleans across an untyped panel/worker protocol, and the native runners duplicate some CDP and Xvfb setup. Named role fields in a shared snapshot contract and common native-test utilities would improve maintainability. Neither is an acceptance failure.

## Spec

No confirmed missing, incorrect, or out-of-scope requirements were found in the same fixed diff. The review checked permission timing, Latin-only routing, original-input preservation, candidate boundaries, bounds and deadlines, stale-result rejection, explicit retry, retained fixtures, and native evidence. An initial HTTP-error-body concern was withdrawn after confirming executor failures abort the fetch signal.

Full dictionary retrieval, configurable provider chains, bounded result restoration, and worker-interruption recovery remain assigned to later tickets. This slice does not claim those outcomes or final delivery/Orca acceptance.

Standards: 0 hard violations and 2 maintainability suggestions, with the positional message contract the larger concern. Spec: 0 confirmed findings.
