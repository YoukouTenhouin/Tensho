# Dictionary alternatives and full articles

Ticket [#16](https://github.com/YoukouTenhouin/Tensho/issues/16) adds the Latin analysis → uncertain Lewis & Short alternatives → selected full article reading path. Validation was performed on 2026-10-04 with Node 24.18.1, npm 11.16.0, and Microsoft Edge 154.0.4258.37 on the existing openSUSE/KDE development environment. Visible native runs used isolated Xvfb, leaving the shared monitors available.

## Delivered behavior

Opening a candidate resolves alternatives; it does not retrieve an article. Labels identify Lewis & Short, the actual index keys, and entry IDs before retrieval. Every alternative remains unverified, including a singleton. The resolver preserves the original headword, unknown stable morphology identity, and response-local provenance. It uses only the first comma-separated headword component and collects actual exact-root, `@root`, and positive-numbered sibling rows. It preserves encounter order and duplicate-row provenance, deduplicating IDs only within one candidate. It neither manufactures missing siblings nor interprets the `@` marker as an article ID.

An index miss is unresolved mapping, not proof of dictionary absence. It does not initiate lemma search or another request. Choosing an indexed alternative retrieves only that ID, verifies the returned entry identity, and displays complete readable Unicode paragraphs, supplied credits, and safe links. Multiple chosen articles remain available without rerunning analysis. Resolution and retrieval errors stay local and offer explicit retry.

Production extraction uses pinned parse5 8.0.1 to create inert parser data, never a live provider DOM. Scripts, styles, foreign markup containers, embeds, and other active subtrees are omitted. Extension-owned elements receive text through `textContent`; only separately validated HTTPS links without credentials or parser-repaired whitespace become anchors. The successful request URL is validated against the chosen entry and displayed as a source link. Wording, diacritics, Greek quotations, examples, cross-reference text, and credits remain intact; original typography is not promised.

Analysis and dictionary work share the same executor and permission guard. Concurrency is two operations, requests are bounded to 15 seconds, and each explicit resolution or retrieval starts its own 30-second action deadline. Waiting for the learner to choose an alternative consumes no retrieval deadline. Queue dispatch checks access; dictionary completion checks it again. Decoded articles are limited to 1 MiB and indexes to 8 MiB before parsing. Navigation or replacement lookup invalidates dictionary work using the analysis generation and source identity.

Only the dictionary index is cached persistently. Its key includes the integrated dictionary, configuration, and validated format; its lifetime is 24 hours. Fresh saved data is revalidated, expired data must refresh, and refresh failure is a technical error without stale reuse. No article or selected-query cache is persisted.

## Evidence

- `npm run check`: **48 behavioral tests pass**, with type checking and the production build. Tests cover retained ambiguity, actual-row resolution, missing identities, singleton uncertainty, cache freshness/expiry/corruption, failed refresh, exact/one-over byte bounds, HTTP and malformed responses, identity mismatch, local retry, multiple articles, queued/in-flight permission removal, detached sources, and late completion after replacement lookup.
- A full observed index of **59,859 rows / 1,003,305 decoded bytes** passed the production parser. Multiword index keys are legitimate and retained. The original retained research rows and 12 full articles are in `tests/fixtures/lewis-short`; `evidence.json` identifies their sources. This observation does not establish exhaustive dictionary coverage.
- [Live dictionary evidence](16-live-dictionary.json): **24 checks pass** using the unmodified live extension in isolated Edge. Actual native Deny/Allow prompts grant exactly the two Alpheios origins. Setup, missing access, and denial send no provider requests. The explicit `important` analysis yields `importo`; candidate expansion fetches the index, and choosing `n21985` fetches one article. All five extracted paragraphs, credit, and the successful-request source link appear. Analysis and generation remain unchanged. Reopening does not fetch again. Dictionary-only revocation prevents new resolution despite the fresh cache, and explicit local retry sends no guarded request.
- [Inert reading-path evidence](16-inert-rendering.json): **10 checks pass** in actual headless Edge using controlled responses through the production adapter, coordinator, extractor, and renderer. All 12 retained articles exactly match independently retained research paragraph text. Hostile markup remains inactive while readable prose and credits survive. The ordinary test page has no extension CSP; an active-content positive control confirms that CSP is not hiding an unsafe renderer. Deliberately corrupt serialized links are rejected again at presentation. Controlled confirmed absence, unresolved mapping, and technical failure render distinctly. This is controlled browser evidence, not a live dictionary absence claim.
- [Reading regression evidence](16-controlled-reading.json): **36 native checks pass** on isolated Xvfb using the separate controlled-analysis build after the dictionary controls were added.
- A clean `npm ci --offline` followed by `npm run check` reproduced all **nine production artifact SHA-256 hashes** exactly. No vulnerability was reported by npm's install audit.

The live access run preceded the behavior-preserving extraction of the shared permission helper; the final shared guard passed all behavioral checks and the native reading regression. Browser scripts record their observation time and distinguish live from controlled responses. The native access runner attaches to the worker to observe network events; it is not a worker-idle restoration test.

## Standards

Read-only review of `13a87521adabab85719e2104a3f9a841be408601...dc9e730e740f19088d64b808885ade7e4abb6876` found **zero documented-standard violations**. Alternatives and candidate identity follow ADR 0005, lazy retrieval follows ADR 0009, inert presentation follows ADR 0008, and index expiry follows ADR 0007.

One nonblocking judgment call: possible **Data Clumps** in `src/core/dictionary.ts` and worker dispatch. Candidate operations repeatedly pass `(tabId, generation, candidateIndex)`; a future shared `CandidateReference` type could express that these fields identify one response-local candidate and reduce argument-order mistakes. This does not indicate an observed identity or isolation defect.

## Spec

The independent read-only review found **zero confirmed findings**: no missing requirements, incorrect behavior, or scope creep. The reviewed implementation covers the ticket's uncertainty, resolver, retrieval, identity, extraction, cache, permission, bounds, cancellation, retry, and evidence requirements.

Review totals: Standards **0 hard violations / 1 nonblocking maintainability suggestion**; Spec **0 findings**.

## Remaining delivery scope

Completed analyses and articles currently live in worker memory. Session persistence, bounded result retention, interruption recovery, configurable provider chains, and the remaining release acceptance work belong to their designated implementation tickets. This ticket does not establish those later gates. No live dictionary confirmed-absence contract or exact cross-provider lemma identity is claimed; the live Latin resolver always requires learner selection.
