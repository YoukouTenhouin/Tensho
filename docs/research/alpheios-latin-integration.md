# Alpheios Latin integration validation

Research date: 2026-10-04. Investigation: [issue #10](https://github.com/YoukouTenhouin/Tensho/issues/10), validating the provisional defaults and normalized contract agreed in [issue #5](https://github.com/YoukouTenhouin/Tensho/issues/5#issuecomment-5975781075) and [ADR 0001](../adr/0001-separate-analysis-and-dictionary-roles.md). This is research with finite integration probes, not an extension implementation.

## Recommendation: gate fails; reconsider the provisional integration

Morphology, indexed full articles, and accountless access are demonstrated. The stock Alpheios dictionary adapter is **not a correct exact identity bridge** for the requested ambiguous inputs: its first match for `legi`'s `lego, legere, legi, lectus` is the wrong conjugation's Lewis & Short article. The documented lemma-search fallback returned HTTP 403, including for a nonexistent word, so a valid dictionary no-entry response was not demonstrated. Stable morphology lemma identities are not supplied in these responses. These are material limitations, not reasons to discard otherwise useful morphology results. Keep #9's implementation-readiness gate closed and return this provider choice for reconsideration. A revised integration could retain these services with an explicit, validated ambiguity resolver and unknown identities, but this report does not approve that design. Evidence and exact distinctions follow.

## Acceptance evidence

“Demonstrated” means the stated scope was observed live or passed the explicitly identified controlled probe; “unresolved” means an acceptance requirement still needs evidence; “unsupported” means the examined response/adapter does not provide the assumed capability.

| Acceptance point | Status and evidence |
| --- | --- |
| Response formats, negotiation, earlier Python failure, object/array preservation | **Demonstrated:** JSON/XML negotiation and lossless counts on all requested probes. **Unresolved:** the old Python request/headers/body were not retained, so its historical cause cannot be proved. The same error is reproduced by decoding a live XML response as JSON. |
| Candidate identities, meanings, interpretations, missing fields, attribution | **Demonstrated:** response-local separation, all observed features and meanings, explicit unknown stable IDs, provider attribution, controlled absent fields. **Unsupported:** stable provider lemma IDs in these samples; body URNs identify response bodies, not documented persistent dictionary lemmas. |
| Correct full entries through documented index/adapter, ambiguity, missing and technical failures | **Demonstrated:** indexed importo/puella articles and dictionary entry IDs; alternate lego/malum IDs and their differing articles; live HTTP 403. **Unsupported:** stock first-match adapter as exact ambiguous-lemma mapping. **Unresolved:** valid live no-entry and a validated complete alternative-selection resolver. |
| Actual Edge fetching and backend grants, missing/denied/revoked access, lifecycle | See **Edge access and lifecycle** below for observed browser evidence and limitations. A native user-denied permission prompt remains unresolved. |
| Access requirements, client identity, attribution, links, HTML and operational limits | **Demonstrated:** current accountless requests, first-party client/attribution contract, actual HTML article and response IDs. **Unresolved:** production rendering/sanitization validation. No SLA, quota, or permanent accountless-access promise was established. |
| All requested inputs, Latin routing, original input, provenance | **Demonstrated:** all seven strings (counting mālum/malum separately), explicit `lang=lat&engine=whitakerLat`, unchanged original strings and provider metadata in the snapshot. |
| No-match stopping versus technical fallback; partial results; one attempt; dictionary independence; granted-access restriction | **Demonstrated in controlled contract probe**, including live morphology no-match fixture; **not** evidence that an implemented extension already enforces it. Live technical dictionary failures were observed. Browser permission checks are separately exercised below. |

## Reproduction and evidence scope

[provider_probe.py](issue-10-probes/provider_probe.py) is a finite, sequential Python 3 probe with explicit Accept headers, a 20-second request timeout, no retries, and `clientId=tensho-research`. [provider-results.json](issue-10-probes/provider-results.json) preserves the live responses and normalized morphology from this investigation, plus relevant index rows and dictionary bodies. The snapshot was assembled from the initial individual requests, avoiding duplicate service traffic. The script reproduces their procedure; timestamps, body URNs, and provider responses may change. [contract_probe.py](issue-10-probes/contract_probe.py) runs offline against those responses and controlled outcomes.

```sh
python3 docs/research/issue-10-probes/provider_probe.py > /tmp/tensho-provider-results.json
python3 docs/research/issue-10-probes/contract_probe.py
```

The offline command passed. It verifies candidate counts `1,1,2,1,5,5,0` and interpretation counts `1,5,4,1,13,13,0` in input order, duplicate-spelling separation, both malum meanings, and unknown stable IDs. Temporary network failures are not silently retried. The probe intentionally does not implement a general production schema validator or HTML renderer.

First-party adapter source was inspected at commit [`a27dc27afa166998c15335295a63233219a16741`](https://github.com/alpheios-project/alpheios-core/tree/a27dc27afa166998c15335295a63233219a16741). Live hosted data can change independently of that revision.

## Morphology formats and normalization

The [Tufts configuration](https://github.com/alpheios-project/alpheios-core/blob/a27dc27afa166998c15335295a63233219a16741/packages/client-adapters/src/adapters/tufts/config.json) and [adapter](https://github.com/alpheios-project/alpheios-core/blob/a27dc27afa166998c15335295a63233219a16741/packages/client-adapters/src/adapters/tufts/adapter.js) specify the following request. All seven JSON probes returned HTTP **201**, so success must use the full 2xx range rather than require 200.

```text
https://morph.alpheios.net/api/v1/analysis/word?word=important&engine=whitakerLat&lang=lat&clientId=tensho-research
```

For the same `important` URL, `Accept: application/json` returned `application/json`; `Accept: application/xml` returned `application/xml`; `Accept: */*` returned JSON. Python `json.loads` on the XML response reproducibly raised `JSONDecodeError: Expecting value: line 1 column 1 (char 0)`. JSON explicitly requested by Python parsed successfully. This establishes a content-negotiation failure mechanism, **not the unrecorded earlier request's cause**. Inspect status, MIME type, body prefix and schema before decoding; incompatible successful content is a technical format failure, not no match. [Live request](https://morph.alpheios.net/api/v1/analysis/word?word=important&engine=whitakerLat&lang=lat&clientId=tensho-research); recorded negotiation bodies are in the snapshot.

The envelope is `RDF.Annotation`; `Body`, `rest.entry`, `entry.infl`, and `entry.mean` must be handled as singleton-or-list, while preserving separate bodies. `important` has object `Body` and object `infl`; `puellae` has object `Body` and array `infl`; `legi` has array `Body`; `malum` has array `Body` and one array `mean`. `zzqxx` is a valid annotation with provider/target/rights metadata and **no Body**. Treat this observed valid shape as no-match, not every arbitrary empty/malformed JSON object. The upstream [transformer](https://github.com/alpheios-project/alpheios-core/blob/a27dc27afa166998c15335295a63233219a16741/packages/client-adapters/src/transformers/alpheios-lexicon-transformer.js) also explicitly normalizes collections; a Tensho adapter needs stricter failure classification than simply inheriting every upstream behavior.

### Observed linguistic payloads

These are provider observations, not independent certification of each linguistic reading. Full source fields, order metadata, stems/suffixes, and short meanings remain in the snapshot. Short meanings below are abridged for readability. Every row is routed explicitly to Latin; English meanings do not change lookup language. Sources are the corresponding [morphology endpoint](https://morph.alpheios.net/api/v1/analysis/word?word=legi&engine=whitakerLat&lang=lat&clientId=tensho-research) with only `word` changed as shown, preserved verbatim in the snapshot.

| Original input | Candidate headword(s), meanings and every distinct grammatical interpretation |
| --- | --- |
| `important` | `importo, importare, importavi, importatus`: bringing/importing/causing; verb, first conjugation, present active indicative, third plural. |
| `puellae` | `puella, puellae`: girl/maiden/young woman; noun, first declension, feminine; genitive, locative, dative singular; nominative, vocative plural (**five**). |
| `legi` | `lego, legere, legi, lectus`: reading/gathering; third-conjugation verb, present passive infinitive and perfect active indicative first singular. Separately `lex, legis`: law; third-declension feminine noun, locative and dative singular (**four total**). |
| `amaverunt` | `amo, amare, amavi, amatus`: loving/liking; first-conjugation verb, perfect active indicative third plural. |
| `mālum` | **Five bodies, thirteen interpretations**, exactly the same linguistic payloads as `malum` below despite preserving the macron in the request/target. This observation does not establish a general provider normalization rule. |
| `malum` | `mala, malae`: cheeks/jaws, first-declension feminine genitive plural (1). `malus, mali`: mast/pole, second-declension masculine accusative singular and genitive plural (2). A separate `malus, mali`: apple tree, second-declension feminine accusative singular and genitive plural (2). `malum, mali`: **two** meanings, fruit and evil/misfortune; second-declension neuter nominative/vocative/accusative singular and genitive plural (4). `malus, mala -um, pejor -or -us, -`: bad/evil, positive adjective, first declension; neuter nominative/vocative singular and masculine/neuter accusative singular (4). |
| `zzqxx` | Valid no-match; zero bodies, zero candidate lemmas. No alternate language is inferred or requested. |

### Identities and missing information

The normalized snapshot preserves `originalInput`, identical `queryInput`, `lookupLanguage=lat`, provider, attribution, displayed headword, raw lemma features, every interpretation, and meanings. `providerLemmaId` is **null**. A `providerBodyReference` records `Body.about` and is marked `identityScope=response-local`; it is not promoted to a stable lemma or Lewis & Short ID. Two `malus, mali` bodies remain separate even though their display headwords match. Conversely, the two meanings within one `malum, mali` body remain meanings of that supplied body; inventing two provider lemma IDs would overclaim upstream precision. [Recorded provider responses](issue-10-probes/provider-results.json).

No confidence scores were supplied. The `legi` infinitive lacks person and number; that is retained without invented defaults. No gender is supplied for `important`. Empty `title` and absent source fields are not filled from unrelated candidates. `puellae` and `amaverunt` carry `dict.src=Ox.Lat.Dict.` as upstream lexical metadata; it does not turn their Whitaker short meanings into full Oxford dictionary articles. Controlled removal of a meaning and a person field preserves the remaining usable result and marks absent information by absence/empty collection. A production contract should distinguish unavailable from inapplicable features where the provider permits that distinction; this probe does not invent it.

## Dictionary index, correct articles, and ambiguous identity

The [lexicon configuration](https://github.com/alpheios-project/alpheios-core/blob/a27dc27afa166998c15335295a63233219a16741/packages/client-adapters/src/adapters/lexicons/config.json) identifies Lewis & Short as `https://github.com/alpheios-project/ls`, source `lat`, target `en`, with no short-definition URL. The [documented adapter source](https://github.com/alpheios-project/alpheios-core/blob/a27dc27afa166998c15335295a63233219a16741/packages/client-adapters/src/adapters/lexicons/adapter.js) reads the pipe-delimited [index](https://repos1.alpheios.net/lexdata/ls/dat/lat-ls-ids.dat), retaining repeated rows; tries lemma/principal parts and language-specific alternate encodings; follows `@` special entries; and constructs `&n=<index field1>`. If no index match exists, it constructs `&l=<encoded lemma>`. It does **not** substitute a morphology body URN into an article URL.

The [Whitaker lemma parser](https://github.com/alpheios-project/alpheios-core/blob/a27dc27afa166998c15335295a63233219a16741/packages/client-adapters/src/adapters/tufts/engine/whitakers.js#L95) takes the first comma-separated component as the lemma and retains principal parts. The dictionary adapter stops at its first found index match. It may also use alternate encodings/diacritic stripping late in lookup; such provider-specific transformations must be explicit in Tensho and must retain original input under issue #5's contract.

| Index evidence | Live full-entry evidence |
| --- | --- |
| `importo|n21985` | [&n=n21985](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n21985): 200 HTML; importo, first conjugation; full import/bring-in article. |
| `puella|n39421` | [&n=n39421](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n39421): 200 HTML; pŭella; full girl/maiden article. |
| `lego|@`, `@lego|n26185`; also `@lego1|n26185`, `@lego2|n26186` | [n26185](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n26185) is **lēgo, āvi, ātum, first conjugation**, send/depute. [n26186](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n26186) is **lĕgo, lēgi, lectum, third conjugation**, gather/read. Both returned 200 HTML. The adapter's first hit is wrong for the observed `legi` verb. |
| `malum|@`, `@malum|n27773`; also `@malum1|n27773`, `@malum2|n27774` | [n27773](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n27773) is mălum, a cross-reference to malus; [n27774](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n27774) is mālum, fruit. Both 200 HTML. Choosing only the default alias would lose the fruit alternative accompanying morphology. |
| `malus|@`, `@malus|n27776`, `@malus1|n27776`, `@malus2|n27777`, `@malus3|n27778` | Multiple supplied dictionary identities exist. These three full articles were **not fetched** in this narrow probe; do not claim their contents were validated. |
| `amo|n2280`, `lex|n26431`, `mala|n27674` | Index mappings observed; full articles not fetched in this probe. |

The differing lego and malum articles demonstrate supplied dictionary alternatives. Displaying those alternatives for the learner to choose is consistent with #5; selecting a default alias as an exact identity is not. Enumerating every numbered sibling and validating semantic correspondence would be a **new resolver policy**, not a capability proven in the stock first-match adapter. No complete generalized identity resolver or selection UI was built here.

Full responses have `.alpheios-lex-entry` with `lemma-id="n…"` (preserve this as the dictionary entry identity), article content, and a source footer. A cross-reference-only article such as n27773 is still a valid dictionary entry; it is not automatically a missing result. The exact successful request URL is an available source link; the sampled entries did not supply an external article permalink. Keep dictionary identity, entry ID, `en` explanation language from configuration, content, source URL and rights together. [Live n27773](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n27773).

### Missing entries and technical retrieval failures

`&l=zzqxx` and `&l=malum` both returned HTTP **403** with an XML `AccessDenied` body, despite a `text/html;charset=utf-8` header. The former is therefore **not valid no-entry evidence**. The stock adapter recognizes `alph:error` or `alpheios-lex-error`, including “no entries found,” inside responses, but source recognition alone does not establish the current live response contract. A validated empty-index lookup is also insufficient to assert no entry: the adapter explicitly has a lemma-search fallback. Preserve transport/status errors separately from provider no-entry semantics. [Missing-word request](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&l=zzqxx), [malum request](https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&l=malum), [adapter error handling](https://github.com/alpheios-project/alpheios-core/blob/a27dc27afa166998c15335295a63233219a16741/packages/client-adapters/src/adapters/lexicons/adapter.js).

## Edge access and lifecycle

**Demonstrated, with a denial-UI gap.** [edge_probe.py](issue-10-probes/edge_probe.py) launches actual Microsoft Edge 154.0.4258.37 on Linux in headless mode, loads a minimal unpacked Manifest V3 extension into fresh disposable profiles, and evaluates requests inside its extension service worker via CDP. This is an actual Edge extension observation, not a shell-fetch or Chromium substitute. The recorded run is [edge-results.json](issue-10-probes/edge-results.json). Run `python3 docs/research/issue-10-probes/edge_probe.py > /tmp/edge-results.json` with Edge and Python `websocket-client` available. Ports 9231 and 9232 must be free; no user browser profile is used. Headless loading is a probe mechanism, not a final installation architecture.

Only these backend grants were used in the reproducible run:

```json
"host_permissions": [
  "https://morph.alpheios.net/*",
  "https://repos1.alpheios.net/*"
]
```

The probe has no reading-page grants, content scripts, or `activeTab` permission. Its `storage` permission merely records installation. The three requests are Latin `puellae` morphology with `Accept: application/json`, the Lewis & Short ID index, and the indexed full entry `n=n39421`, in that order. Fetch uses `credentials: 'omit'` and a 15-second application-chosen abort timeout; this timeout is a research setting, not a measured provider guarantee.

| Actual browser state | `permissions.getAll().origins` | Guarded fetch count | Raw fetch outcomes |
| --- | --- | ---: | --- |
| Required backend grants active | Both hosts above | 3 | 201 JSON morphology; 200 index; 200 full `puella` article |
| Same extension switched to “on click” host access | Empty | 0 | All three still return 201/200/200 without the guard |
| Fresh extension declaring only optional backend hosts, never granted | Empty | 0 | All three still return 201/200/200 without the guard |

Revocation was performed through Edge's own extension-management `chrome.developerPrivate.updateExtensionConfiguration` with `hostAccess: 'ON_CLICK'`, using the isolated `edge://extensions/` page. The private management API is **test automation only**, not a proposed extension dependency. Missing and revoked permissions are real browser states; the guard calls the real `chrome.permissions.contains({origins:[origin + '/*']})` and suppresses fetching when false. These results prove that HTTP success is not evidence of a grant: normal cross-origin access can still allow raw requests without extension host privileges. The final contract must gate requests on already-granted permissions, and react to removal, rather than rely on fetch rejection. This is supported by the [official cross-origin request model](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) and [permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions).

**Still unresolved:** a user clicking Deny on a native Edge permission prompt, manual site-access UI behavior, revocation racing with an in-flight fetch, and interaction with reading-page injection. No permission request was made by this runner, so never-granted access must not be described as observed prompt denial. A denied-request branch can be modeled by a controlled test, but that does not close the native UI gap. The official API requires runtime requests to occur within a user gesture and supports permission-removal events; a background fallback must not trigger a new grant prompt. Backend host access remains separate from access to the page being read. [Microsoft's host-permission guidance](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/migrate-your-extension-from-manifest-v2-to-v3) distinguishes content-script page-origin constraints from extension fetches.

In the exploratory browser session, the worker's CDP target disappeared after idle time and could be restarted using CDP `ServiceWorker.startWorker`; no exact shutdown interval was measured. This reinforces the need for restart-tolerant state, but the runner's attached debugger prevents it from being a lifecycle stress test. Chromium's [documented lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) describes idle termination, a 30-second response-wait limit for fetch, and debugger lifetime effects. Do not keep a service worker alive as a correctness mechanism. #9 must specify application-controlled request deadlines, stale-response isolation, and recoverable pending work; these remain architecture decisions and require eventual Edge lifecycle testing.

## Access, attribution, safe content, and limits

The JSON and indexed-article probes succeeded without account credentials. Morphology used the explicit truthful client identifier `tensho-research`; the documented dictionary URLs do not specify a client-ID parameter. Do not invent credentials, impersonate Alpheios's client, or infer permanent anonymous access from these successes. API terms require documented access and honest client identity, permit future credentials and rate limits, and provide no uninterrupted-service guarantee. No numeric quota or SLA was found. Application-controlled timeouts are therefore required policy, not a provider promise; the 20-second probe timeout is a research setting, not a settled production value. [Alpheios API terms](https://alpheios.net/pages/apiterms/).

Morphology's actual rights field is `Short definitions and morphology from Words by William Whitaker, Copyright 1993-2007.` Preserve it with Alpheios/Whitaker provenance. Dictionary configuration credits **A Latin Dictionary**, Charlton T. Lewis and Charles Short, provided by the Perseus Digital Library at Tufts University; successful HTML also includes an 1879 Oxford/Clarendon source footer. Keep both service provenance and dictionary credit. These observations do not establish a blanket redistribution license for all linked materials. [Morphology response](https://morph.alpheios.net/api/v1/analysis/word?word=important&engine=whitakerLat&lang=lat&clientId=tensho-research), [dictionary rights configuration](https://github.com/alpheios-project/alpheios-core/blob/a27dc27afa166998c15335295a63233219a16741/packages/client-adapters/src/adapters/lexicons/config.json).

Dictionary responses are **HTML fragments**, not trusted application markup. A correct endpoint and benign sample are not sanitization guarantees. Prefer a plain-text rendering path initially, or parse through a deliberately limited HTML allowlist; remove scripts, event handlers, active/embed elements, unsafe URLs, and provider-controlled styles before insertion. Validate links separately, preserve attribution as text, and keep raw markup out of the extension/page DOM. Do not use the upstream adapter's `Definition(..., 'text/plain', ...)` label as evidence that the network body is plain text: this was HTML in every successful article. Rendering with `textContent` avoids interpreting remote markup; richer rendering and adversarial sanitizer tests remain implementation work. [Chrome extension network/security guidance](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests#security-considerations), [upstream full-definition constructor](https://github.com/alpheios-project/alpheios-core/blob/a27dc27afa166998c15335295a63233219a16741/packages/client-adapters/src/adapters/lexicons/adapter.js).

## Controlled fallback evidence

The offline [contract probe](issue-10-probes/contract_probe.py) passed the following cases against an intentionally small reference dispatcher. This demonstrates the decided behavior is expressible and that the live fixtures can be used without losing observed ambiguity; it does not validate production adapter failure detection, actual elapsed timeouts, or a finished extension UI.

- Live morphology `zzqxx` fixture as valid no-match stops the analysis chain; a controlled valid dictionary no-entry similarly stops its chain.
- Usable complete and controlled partial results stop the chain. Removing a short meaning/person value does not request a second provider to fill the gap.
- Injected network, timeout, HTTP 403, and unusable-format technical failures each advance to the next eligible provider exactly once. Successful fallback carries the earlier failure list for a brief warning. Exhaustion remains technical failure; a user-triggered retry can start a new chain, but no automatic retry is performed.
- Disabled providers are skipped. Ungranted providers are explicitly reported and never invoked; fallback does not ask for permission. No configured eligible provider yields an unconfigured/missing-access state as appropriate.
- A dictionary technical failure leaves the original analysis object intact and calls no analysis provider.

These are **controlled** outcomes, distinct from the live morphology no-match and live dictionary 403 above. Browser permission checks and worker lifecycle require their separate Edge evidence. Recommendations about manual retry/warnings describe the agreed contract; no UI action was implemented.

## Remaining gate work

Reconsider the provider integration with the demonstrated wrong-entry counterexample in hand. Any continuation needs a verified ambiguity-preserving mapping policy, defined behavior for unknown morphology identities, a live or authoritatively specified dictionary no-entry contract, a native denied-permission check, and safe-renderer validation. The original Python failure should remain historically unresolved unless its request evidence can be recovered; explicit negotiation already provides a workable current parser contract. These findings permit continued contract work in #6–#8 but do not promote the provisional defaults to implementation-ready for #9.
