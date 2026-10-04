# Revised Latin dictionary integration validation

Research date: 2026-10-04. [Issue #12](https://github.com/YoukouTenhouin/Tensho/issues/12), applying [ADR 0005](../adr/0005-preserve-uncertainty-in-dictionary-mapping.md) and [ADR 0001](../adr/0001-separate-analysis-and-dictionary-roles.md). This report supplements the [issue #10 investigation](alpheios-latin-integration.md); it does not rewrite its observations or implement an extension.

## Result: the revised research gate passes

Retain Alpheios-hosted Whitaker analysis and Lewis & Short as the provisional Latin integration for #9's implementation-ready specification. A bounded conservative resolver exposes the observed dictionary alternatives without first-match selection, semantic filtering, ranking, or claims of exhaustive coverage. Twelve full articles have verified dictionary entry identities. **None establishes an exact morphology-to-dictionary identity mapping**, so even a singleton result remains an explicitly uncertain alternative requiring learner selection. Native Edge permission denial and a concrete plain-text rendering path now have browser evidence. These are research passes, not claims that production extension behavior is implemented. [Resolver evidence](issue-12-probes/resolver-evidence.json), [resolver assertions/results](issue-12-probes/resolver-results.json), [native denial evidence](issue-12-probes/edge-denial-results.json), [rendering evidence](issue-12-probes/render-results.json).

| Issue #12 requirement | Assessment | Evidence and limits |
| --- | --- | --- |
| Conservative ordinary and ambiguous dictionary resolution | **PASS, bounded scope** | Current index scanned for nine roots; 12 full article IDs verified across ordinary inputs, `legi`, and `malum`/`mālum`. All alternatives exposed; automatic selection is null. Numbered siblings are an observed index convention, not an exhaustive linguistic rule. |
| Response-local candidates and unknown stable identities | **PASS, reused evidence** | #10's seven morphology fixtures retain candidate counts 1/1/2/1/5/5/0 and interpretation counts 1/5/4/1/13/13/0. Separate `malus` bodies stay separate; the single `malum` body's two meanings stay together. |
| Unresolved mapping and technical-only fallback | **PASS, live fixtures plus controlled dispatcher** | Actual index miss is unresolved; recorded HTTP 403 is technical failure. Controlled unresolved, usable partial, and confirmed-no-entry outcomes stop their role's chain; only technical failure advances. Live dictionary absence remains **unresolved and is not asserted**. |
| Native Edge permission denial | **PASS** | Real native prompt displayed; physical-input automation clicked Deny; API resolved false; permission origins remained empty; guarded morphology/index/article fetch count was zero. Granted, never-granted, and revoked states reuse #10. |
| Safe readable dictionary rendering | **PASS, bounded path** | Actual Edge rendered extracted text from all 12 articles with attribution and HTTPS source links. Hostile markup/URLs did not create active elements or run handlers; a positive control confirmed inline handlers could execute in the test page. |

Each assessment is scoped to the probes below. Remaining lifecycle, permission-removal race, and production rendering integration checks belong in #9; this investigation does not establish those behaviors. Exhaustive alternatives, stable morphology IDs, and proof of a live dictionary no-entry response are not prerequisites under ADR 0005.

## Conservative resolver and article identities

The pinned [Alpheios dictionary adapter](https://github.com/alpheios-project/alpheios-core/blob/a27dc27afa166998c15335295a63233219a16741/packages/client-adapters/src/adapters/lexicons/adapter.js#L426) documents `@` as an escape for pre-normalized keys and stops after its first found lookup. Its `_lookupSpecial` returns `@<lookup>`; it does not establish a general numbered-sibling resolver. The live [Lewis & Short index](https://repos1.alpheios.net/lexdata/ls/dat/lat-ls-ids.dat) supplies both default aliases and explicitly numbered rows for the tested `lego`, `malum`, and `malus` families. [resolver_probe.py](issue-12-probes/resolver_probe.py) implements and asserts this **research policy**, independently of stock first-match behavior:

1. Take the first comma-separated component of the supplied morphology headword as the index root. Preserve the original input, candidate position, provider body reference, meanings, and interpretations separately. No additional case conversion, macron removal, principal-part matching, or grammatical inference is needed for these fixtures.
2. Collect every row whose key is the exact root, `@root`, or `@root` followed by a positive decimal integer. Read only IDs actually present in those rows; never manufacture IDs or stop at a missing number. Retain every matching row's provenance. Ignore the `@` marker itself as an article target.
3. Deduplicate repeated dictionary IDs **within a candidate's alternatives**, preserving index encounter order for reproducibility. This is not a confidence order, and candidate bodies are never deduplicated. No meaning, gender, conjugation, or observed article sense changes membership or ordering.
4. Fetch indexed IDs using the documented `&n=` article URL. Verify the returned `.alpheios-lex-entry` identity matches the requested ID before exposing the article. Report an HTTP failure or malformed/mismatched identity as technical failure. The probe's narrow expected-shape check is not a general production schema validator.
5. Expose the available entries as uncertain, non-exhaustive alternatives with `automaticSelection: null`. An index miss is `unresolved-mapping`. There is no automatic lemma-search request on index miss in this policy; the unavailable correspondence does not become definitive absence or a fallback trigger.

The current index has **59,859 rows**. Its decoded UTF-8 body SHA-256 is `dcb5847f75393eac2b75950a1e6ac8e3fc8bc41dfc9e6575ab7e6e2415018c66`. The snapshot retains all rows matching the declared roots, the total row count, URL, status, and hash. The live capture scans the entire index before retaining this subset, including confirming no matching `zzqxx` key. Offline replay verifies the captured subset; re-running `--live` checks the current provider index again. [Index capture](issue-12-probes/resolver-evidence.json).

| Candidate root / selected input | Actual index rows and available article identities | Article content observed |
| --- | --- | --- |
| `importo` / `important` | `importo → n21985` | [n21985](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n21985): importo, first conjugation; importing/bringing in. |
| `puella` / `puellae` | `puella → n39421` | [n39421](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n39421): pŭella, girl/maiden. |
| `amo` / `amaverunt` | `amo → n2280` | [n2280](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n2280): ămo, first conjugation; liking/loving. |
| `lego` / `legi` | `lego → @`; `@lego`, `@lego1 → n26185`; `@lego2 → n26186` | [n26185](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n26185): lēgo, āvi, ātum, first conjugation, including send/depute; [n26186](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n26186): lĕgo, lēgi, lectum, third conjugation, gather/read. **Both retained**, despite the obvious conjugation distinction. |
| `lex` / `legi` | `lex → n26431` | [n26431](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n26431): lex, lēgis, feminine; law/bill. |
| `mala` / `malum` and `mālum` | `mala → n27674` | [n27674](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n27674): māla, feminine; cheek-bone/jaw. |
| `malus` / `malum` and `mālum` | `malus → @`; `@malus`, `@malus1 → n27776`; `@malus2 → n27777`; `@malus3 → n27778` | [n27776](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n27776): mălus, adjective, bad/evil; [n27777](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n27777): mālus, feminine, apple tree; [n27778](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n27778): mālus, masculine, mast/pole. **All three offered to each of the three `malus` candidates**, without grammatical filtering. |
| `malum` / `malum` and `mālum` | `malum → @`; `@malum`, `@malum1 → n27773`; `@malum2 → n27774` | [n27773](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n27773): mălum, cross-reference to `1. malus`; [n27774](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n27774): mālum, neuter, apple/tree-fruit. Both retained. A cross-reference article is usable content, not absence. |
| `zzqxx` / index miss probe | No matching rows | Unresolved dictionary mapping; no claimed dictionary absence and no dictionary request made by the resolver. |

Six full articles reuse the issue #10 [live snapshot](issue-10-probes/provider-results.json): importo, puella, both lego articles, and both malum articles. Only the six previously unexamined articles were fetched for this follow-up: amo, lex, mala, and three malus articles. All six new responses returned HTTP 200 with the expected dictionary `lemma-id`. The table describes their content, **not a machine-verifiable cross-provider correspondence rule**. The finite union policy passes these cases; behavior across other index families and changes to the index format remains outside the coverage claim. [New live bodies](issue-12-probes/resolver-evidence.json), [all 12 identity assertions](issue-12-probes/resolver-results.json).

For presentation, a suitable label is “Possible dictionary entries; these may not include every matching entry.” Even the one-entry ordinary cases use that uncertainty model. The user may choose an entry to read; recording that choice must not invent a verified provider lemma identity. The provider's root/index agreement supplies a useful search association, not the exact identity bridge ADR 0005 requires for automatic selection. This is an integration recommendation derived from the evidence above.

## Preserved morphology and fallback distinctions

The follow-up re-normalizes all seven original morphology bodies, makes no new morphology requests, and asserts the original candidate/interpretation counts. Both `mālum` and `malum` retain five candidates and thirteen interpretations. The two noun candidates displayed `malus, mali` remain distinct response positions with distinct meanings: mast/pole and apple tree. The separate adjectival `malus` body also remains separate. Each gets the same three dictionary alternatives; sharing a dictionary alternative list does not merge the analysis candidates. The single `malum, mali` body retains **both** fruit and evil/misfortune meanings. Stable lemma identity remains null; response-local body references are retained only in the reused normalized analysis. The different original selected strings remain unchanged while their supplied headwords happen to yield the same roots. [Original provider bodies and normalized provenance](issue-10-probes/provider-results.json), [follow-up assertions and candidate lists](issue-12-probes/resolver-results.json), [documented morphology request](https://morph.alpheios.net/api/v1/analysis/word?word=malum&engine=whitakerLat&lang=lat&clientId=tensho-research).

The resolver probe exercises these outcomes separately:

| Outcome | Evidence type | Required role behavior |
| --- | --- | --- |
| `zzqxx` index has no usable matching rows | Current live index scan | Unresolved mapping, no fallback, retain analysis; do not say the dictionary has no entry. This is a dictionary resolver input probe, not a new morphology candidate for `zzqxx`. |
| `&l=zzqxx` returns HTTP 403 | Recorded live #10 response reused | Technical failure, never no-entry. When a configured eligible second provider exists, the controlled dispatcher advances once and retains the failure reason. The revised resolver itself does not send this lemma request on an index miss. |
| Malformed or mismatched successful article | Controlled bodies | Technical format/identity failure; advance only if no usable result is available. |
| Network failure / timeout | Controlled outcomes | Technical failure; advance once to the next eligible provider, without automatic retries. |
| Some dictionary alternatives usable, another failed | Controlled partial result containing a failed-entry record | Stop fallback with usable alternatives and an explicit per-entry failure; no second provider used to fill the gap. |
| Confirmed dictionary no-entry | Controlled outcome only | Stop fallback. No current live absence contract was established or silently assumed. |

These are assertions against a small reference dispatcher, not live timeout, retry, or production failure-classification tests. Its returned failure list preserves prior technical failures. Analysis remains intact through dictionary failures; no analysis provider is called to repair a dictionary failure. The existing [#10 contract probe](issue-10-probes/contract_probe.py), rerun successfully, separately preserves partial analysis fields, confirms the live morphology no-match fixture stops fallback, and verifies disabled/ungranted providers are skipped. The [revised probe](issue-12-probes/resolver_probe.py) adds terminal unresolved mapping and explicitly separates verified article identity from uncertain correspondence. [ADR 0001](../adr/0001-separate-analysis-and-dictionary-roles.md), [ADR 0005](../adr/0005-preserve-uncertainty-in-dictionary-mapping.md).

## Native Edge denial closes the previous gap

[edge_denial_probe.py](issue-12-probes/edge_denial_probe.py) used **Microsoft Edge 154.0.4258.37**, headed on an isolated Xvfb display, a fresh disposable profile, and a minimal unpacked Manifest V3 extension with only these optional backend hosts:

```json
["https://morph.alpheios.net/*", "https://repos1.alpheios.net/*"]
```

A button click initiated `chrome.permissions.request` during active user activation. The actual native permission dialog named both hosts. After inspecting the [prompt screenshot](issue-12-probes/edge-denial-prompt.png), XTest delivered a pointer click to the visible **拒绝 (Deny)** button. The request resolved `false`, the granted origins remained empty, and the guard suppressed all three morphology/index/full-article requests: **zero fetches** before and after denial. The [post-denial screenshot](issue-12-probes/edge-after-denial.png) and [event/result capture](issue-12-probes/edge-denial-results.json) distinguish this native refusal from never-granted access or a mocked API branch. `--ozone-platform=x11` ensures the browser uses the isolated display. Coordinates are specific to the observed layout; the runner supports inspecting a fresh screenshot before supplying the click location.

This is consistent with the official [permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions), which requires a user gesture for runtime requests and returns whether permission was granted. The integration still needs a real `permissions.contains` guard on every eligible backend request: #10's [actual Edge evidence](issue-10-probes/edge-results.json) showed raw fetch could succeed after revocation and without grants. HTTP success is not permission evidence. Reuse those granted/never-granted/revoked observations; the recorded native-denial run made no provider fetches.

Not exercised here: permission removal racing an in-flight fetch, user manipulation of page-access controls, reading-page injection, stale responses, or service-worker restart recovery. #9 must retain explicit deadlines, stale-result isolation, permission-removal handling, and restart-tolerant state as implementation and eventual Edge acceptance criteria. No additional permission prompt may be initiated automatically by fallback. The [documented service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) remains relevant; these attached-debugger probes are not lifecycle stress tests.

## Concrete safe content path

[render_probe.py](issue-12-probes/render_probe.py) validates a deliberately simple path: parse provider HTML inertly with Python's `HTMLParser`, omit script/style/embed/foreign-content subtrees, extract Unicode text with paragraph boundaries, and collect HTTPS links as strings. The browser receives only that structured data. It constructs its own `section`, `pre`, and `a` elements, sets article content using `textContent`, and constructs source links separately. Raw provider markup is never assigned to browser `innerHTML`, parsed as a browser document, or adopted into the DOM. This follows Chrome's [recommendation to use safe DOM APIs for fetched content](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests#security-considerations); it is a feasibility probe whose Python extraction step must be implemented safely in the eventual extension environment.

Both extraction and the browser link boundary reject non-HTTPS schemes and credential-bearing URLs; the browser also rejects whitespace/control characters and invalid URLs. Link text is set with `textContent`, and each new-tab link has `rel="noopener noreferrer"`. The exact successful indexed request URL is retained as “Dictionary source.” The sampled articles supply their credit text; the probe asserts all 12 preserve **A Latin Dictionary**, Lewis, and Short, including the source footer. It preserves macrons, Greek text, definitions, examples, and cross-reference text as readable text rather than typographic HTML. The captured rendered text enables inspection without refetching. Safe relative HTTPS and explicit HTTPS citation links were also tested with controlled inputs; no claim is made that every sampled article supplied such anchors. [Input articles](issue-12-probes/resolver-evidence.json), [reused input articles](issue-10-probes/provider-results.json), [complete rendered text and links](issue-12-probes/render-results.json).

The actual Edge probe rendered all **12 articles plus one adversarial case**. Controlled attacks covered inline event handlers, scripts, image loads, iframe/srcdoc, object, SVG, MathML, styles, templates, entity-encoded JavaScript URLs, data URLs, credentials, and raw markup injected directly into the final text field. The resulting DOM contained only **SECTION, PRE, A**; no provider attributes or active markup survived; the execution counter stayed zero. A separate unsafe positive control executed its inline handler once in the same page, demonstrating that CSP was not hiding an otherwise active payload. The browser rejected five unsafe link values deliberately inserted after extraction. All rendered article strings matched extracted strings exactly, and the total output contained 15 safe links (12 article source links and three links in the adversarial case). [Browser assertions/results](issue-12-probes/render-results.json).

This validates a text-and-links boundary, not a general HTML sanitizer, rich formatting, production UI layout, or an exhaustive hostile-input audit. The extension can retain these security properties by keeping all provider text out of markup interpretation and constructing only validated links. A richer HTML renderer would need separate validation. Provider attribution, truthful client identity, accountless-access observations, and operational limits otherwise reuse the [original access/attribution evidence](alpheios-latin-integration.md#access-attribution-safe-content-and-limits); no new accountless guarantee, quota, license, or SLA is inferred.

## Reproduction

Python 3 is required; browser probes also need actual Microsoft Edge and `websocket-client`. The native denial probe additionally needs Xvfb, ImageMagick `import`, and the X11/XTest libraries named in its source. Use disposable profiles; no user profile is read or modified. Browser launch/local CDP may require execution outside a restricted sandbox. No production files are changed.

```sh
# Offline assertions against retained provider evidence.
python3 docs/research/issue-12-probes/resolver_probe.py
python3 docs/research/issue-10-probes/contract_probe.py

# Optional live refresh: exactly one index plus six new-article requests,
# 20-second per-request timeout, no retries, no morphology calls.
python3 docs/research/issue-12-probes/resolver_probe.py --live

# Actual Edge content probe; reads saved articles, makes no provider requests.
# Requires local debugging port 9245 to be free.
python3 docs/research/issue-12-probes/render_probe.py

# Actual headed Edge native prompt; inspect screenshot and enter Deny location.
python3 docs/research/issue-12-probes/edge_denial_probe.py --output /tmp/edge-denial
```

The resolver and renderer emit JSON on stdout; `--live` also updates `resolver-evidence.json`. The saved `resolver-results.json` is an exact offline replay of that evidence. Reproduction can write stdout to `/tmp` to leave the checked-in summaries unchanged. Provider bodies, dictionary index data, native-dialog layout, browser versions, and timestamps may change on later runs. A failed live request is surfaced, not silently retried or recast as missing dictionary content.

Proceed with #9 using the explicit uncertainty model and bounded renderer path. Carry the unexercised production/browser acceptance criteria above into its specification. No research evidence in this follow-up requires reopening provider selection; Sanskrit research #11 remains independent as specified by issue #12.
