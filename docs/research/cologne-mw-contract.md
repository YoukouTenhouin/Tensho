# Cologne MW access and article contract

Research date: **2026-10-05 UTC**. Investigates [#19](https://github.com/YoukouTenhouin/Tensho/issues/19), following [#11][history] and [#18](sanskrit-analyzer-contract.md). This report preserves the analysis/dictionary separation, uncertainty and lazy retrieval rules in [ADR 0001](../adr/0001-separate-analysis-and-dictionary-roles.md), [0005](../adr/0005-preserve-uncertainty-in-dictionary-mapping.md) and [0009](../adr/0009-lazy-dictionary-retrieval-and-fallback.md). It does not implement a production adapter or change Sanskrit passage scope.

## Recommendation

**Cologne native MW remains unsuitable for release through the tested Edge path.** A single fresh, accountless GET from actual Edge MV3 again returned HTTP 500 with an empty body. Investigation stopped immediately. The historical article bytes have now been recovered and verified, exposing a concrete record-versus-article mismatch and malformed inline XML. A bounded inert extraction and actual Edge text rendering experiment passes, but full article boundaries, identity retrieval, supported hosted use and operational quota remain unresolved. Keep Sanskrit readiness blocked; Latin delivery remains independent. [Fresh Edge evidence](issue-19-probes/edge-access-results.json), [article provenance](issue-19-probes/article-provenance.json), [extraction results](issue-19-probes/article-extraction-results.json), [Edge rendering results](issue-19-probes/edge-render-results.json), [#21](https://github.com/YoukouTenhouin/Tensho/issues/21).

Investigate the separately hosted **C-SALT/Kosh MW TEI API** as the next candidate, after its service conditions are established. Its operator publishes an MW dataset, hosted REST/GraphQL routes and an `xml:id`-based entry index; that is evidence for a candidate, not evidence that its current browser access, complete compound/homograph retrieval or content correspondence passes. No request was made to that service, and it must not become an automatic alternate route around the failed native service. [Operator README][csalt], [MW index mapping][mapping].

## Evidence and scope

The access experiment used **Microsoft Edge 154.0.4258.37**, a disposable profile and a Manifest V3 service worker in `--headless=new`. This is the real Edge executable, not a user-agent imitation. It made one GET at **2026-10-05T02:35:20.113Z**, with declared host permission, `credentials: 'omit'` and `redirect: 'error'`. Local research bounds were **one request, zero retries, 15 seconds and 1 MiB**. They are not provider quotas or supported response limits. Revoking permission and invoking the application's guard produced zero additional fetches. No shared-desktop window, native input or audio change was needed. [Harness](issue-19-probes/edge_access.py), [recorded manifest/request/response](issue-19-probes/edge-access-results.json).

The three article responses were **not downloaded again**. Exact bytes retained locally from #11 were recovered and checked against the byte counts and SHA-256 hashes committed at `5edfa389d9eed6fefe88184648355a709aae7f68`. Their original observation date is 2026-10-04; the original timestamps identify batch completion, not exact request start. The saved responses total 36 records: `agni` (10), `mA` (23), and Devanāgarī `धर्मक्षेत्र` resolved as `Darmakzetra` (3). Provenance records the old request URLs and hashes; offline validation recomputes them. [Provenance](issue-19-probes/article-provenance.json), [historical metadata][old-results], [offline checker](issue-19-probes/extract_articles.py).

Source inspection is pinned independently of the unversioned hosted deployment:

| Source | Revision inspected | What it establishes |
| --- | --- | --- |
| `sanskrit-lexicon/csl-apidev` | `633fcb1a49fd57329d3f9f3e92da5be426759006` | Native XML lookup, data-access and display behavior. [XML class][xmlclass], [DAL][dal], [display][display]. |
| `sanskrit-lexicon/MWS` | `ced58ea7a5c2c1faec2eab8cc302fc5d3199f172` | Maintainer explanation of hierarchy, content tags, inherited/linked data and source notation. [Entry guide][entryguide], [data dictionary][datadict]. |
| `sanskrit-lexicon/csl-pywork` | `8e00691fd63ab406927c66cf20437200558eca60` | MW XML grammar with `h`, `body`, `tail`, hierarchy and string record IDs. [DTD][dtd]. |
| `sanskrit-lexicon/csl-orig` | `55e8addbd96e8d9001b8789026b026763f4049c1` | Canonical content license; it does not identify the served database version. [License][license]. |
| `sanskrit-lexicon/csl-guides` | `9ec981f02c741b66cf255f1ddc07bcbd48dc10d0` | Native live/alpha versus Salt/clean-URL roadmap status. [API guide][guide]. |
| `cceh/c-salt_sanskrit_data` | `cb06c4cfc80c3afa38bee9b87120b06f2ebbd9e0` | Independently published hosted TEI candidate and field mapping. [README][csalt], [mapping][mapping]. |

Only selected source/documentation files and repository metadata were fetched from GitHub. No whole dictionary, scan corpus, or bulk result replay was fetched. Pinned source corroborates design explanations; it is **not proof of the code/data currently deployed**. [Retained response provenance](issue-19-probes/article-provenance.json), [fresh request count](issue-19-probes/edge-access-results.json).

## Native request contract and access discrepancy

The tested URL is:

```text
https://www.sanskrit-lexicon.uni-koeln.de/scans/awork/apidev/getword_xml.php?dict=mw&key=agni&input=slp1&output=roman
```

The source declares JSON fields `dict`, `input`, `output`, canonicalized `key`, `accent`, `xml`, `html`, and `status`. Both content arrays have one item per selected database record. `input=slp1`, `deva`, and `roman` have positive historical samples; the literal alias `iast` does not. Encode the unchanged query parameter with UTF-8 URL encoding. The absence of an `accent` query parameter in the experiment leaves provider default behavior in effect; applications must retain the actual response echo rather than assume accents were retained or removed. `getword_xml` is explicitly alpha. [XML documentation][xmldoc], [XML class][xmlclass], [historical requests][old-results].

Fresh Edge received **500, zero bytes**, with `server: Varnish` and no exposed `Access-Control-Allow-Origin` header. It received an HTTP response rather than a JavaScript CORS rejection. This rules out “the extension forgot host permission” for this trial and does not establish CORS as the cause of the 500. The header alone cannot tell whether the response came from the origin, an intermediary or an environment proxy, or which underlying error occurred. There is no payload to classify as a dictionary miss. [Edge evidence](issue-19-probes/edge-access-results.json).

Historical Python success, historical Edge failures and the fresh Edge failure establish a repeatable browser-side observation across those dates, **not a controlled same-time client comparison**. No fresh Python request followed the failure, no user agent was spoofed, no alternate native route was tried, and no retry or challenge bypass was attempted. The root cause remains unresolved. An operator should correlate the exact timestamp, URL and headers with their logs before further paired diagnostics are agreed. [Historical report][history], [fresh harness](issue-19-probes/edge_access.py).

The guide describes accountless browser access and says rate limiting is absent, while #11 recorded HTTP 429. Neither that guide nor wildcard CORS in historical success is a numeric quota, cooldown guarantee or affirmative resolution of session-retention/hosted-use conditions. Stop automatic requests on 403/429/500; do not infer that moving to a new endpoint grants a fresh request allowance. Numeric production budget, deployment identity and operator-supported extension access stay with [#21](https://github.com/YoukouTenhouin/Tensho/issues/21). [Guide][guide], [historical failures][old-results].

## Records, article boundaries and identity

The key technical distinction is directly visible in source. **`getword_xml` does not assemble complete MW articles.** A key lookup invokes `get1_xml`, selecting rows whose database key equals the query, ordered by `lnum`. An `lnum` request invokes `get2(lnum, lnum)`, selecting a record. The separate display path has `get1_mwalt`/key-document logic and older forward/backward expansion for related records. Therefore neither the key array nor a successful single `lnum` response proves a complete article. [XML class][xmlclass], [DAL][dal].

Hierarchy codes are structural rather than independent alternatives: `H1` is a main entry, `H1A` a continuation sense, `H2` a derived form and `H3` a compound sub-entry. Related records are siblings in source order, not nested XML children. The corpus also contains `H1B` variants, `H3B` variants and `H1E` etymological material. Preserve the original code rather than turn every suffix into “another homograph.” Header `hom` differs from homograph numbers quoted *inside* a definition; only the header identifies that record's supplied homograph marker. Decimal identifiers are opaque **strings**, including trailing zeroes such as `161686.10`. [Entry guide][entryguide], [data dictionary][datadict], [grammar][dtd], [fixtures](issue-19-probes/article-extraction-results.json).

The [boundary fixture](issue-19-probes/article-boundaries.json) records these **grouping hypotheses**, not verified complete-article units:

| Lookup | Records and observed structure | Boundary consequence |
| --- | --- | --- |
| `agni` | `890` H1; `891`–`897` and `897.05` H1A; `897.1` H1E, p. 5 col. 1 | First record omits nine supplied records, including later senses and etymology. Retain the ordered ten-record group for investigation; broader derived/compound surroundings are not in this key response. |
| `mA`, leading fragment | `153882`–`153889`, all H1B, p. 771 col. 2 | This response starts in a variant block and does not supply its preceding parent. Seven following records mark `lex="inh"`; record `153884` points to phrasal child `153891.1`, absent here. Keep the fragment explicitly unresolved. |
| `mA`, homograph 1 | `161686` H1; ten H1A records `161686.05` through `161686.50`, pp. 804 cols. 1–2 | Eleven records belong to the observed numbered section; stop before the explicit homograph-2 head. This is a fixture grouping, not proof of every dependent source record. |
| `mA`, homographs 2 and 3 | `161693` H1 homograph 2; `161697` H1 homograph 3 plus `161697.1` H1E | Keep the two numbered heads separate and the etymology attached to its observed section. Do not assign it to homograph 2. |
| `mA`, homograph 4 | `161698` **H2**, header homograph `4`, p. 804 col. 2; revision annotation points to p. 1331 col. 2 | Corrects #11's summary implication that every numbered `mA` head was H1. Preserve revision and hierarchy; a homograph need not be H1. |
| `धर्मक्षेत्र` / `Darmakzetra` | `99972` H3, p. 510 col. 3; `99973`, `99974` H3B, p. 511 col. 1 | The page break is not an article boundary. The third record inherits lexical information; compound-parent context is absent. First-record-only rendering drops both supplied variants. |

Every row is backed by the [hash-verified full responses](issue-19-probes/article-provenance.json) and [parsed record metadata/text](issue-19-probes/article-extraction-results.json). Their hierarchy agrees with the maintainer's structural documentation, but **this run did not compare the complete groups against an independently retrieved canonical source excerpt or printed scan**. Pages 5, 510–511, 771, 804 and revision page 1331 identify the needed comparisons. No “complete article” gate passes on this evidence alone. [Entry guide][entryguide], [boundary fixture](issue-19-probes/article-boundaries.json).

A future resolver should retain `(provider, dictionary, response/deployment provenance, recordId)` plus header key, code, homograph, page and ordered related IDs. Upon learner selection, verify every returned record ID and relevant header against the selected group and separately establish its boundary/context contract; an unexpected record is a technical payload mismatch. A record ID is not an analyzer lemma ID or an independently verified lexeme identity. For `मा#२`, retain the analyzer original and suffix; convert only isolated `मा` to `mA` for resolution. Never equate `#२` with MW homograph `2`, select the first record, rank by apparent meaning, or auto-select a singleton without verified correspondence. [#18 conversion contract](sanskrit-analyzer-contract.md#display-and-lemma-handoff-conversion), [ADR 0005](../adr/0005-preserve-uncertainty-in-dictionary-mapping.md), [XML selection source][xmlclass].

## Concrete inert extraction experiment

[extract_articles.py](issue-19-probes/extract_articles.py) reads only local, hash-verified responses. It validates a bounded record envelope and retains every record separately; it does **not** implement the unverified resolver. It extracts header identity separately from body text, treats record boundaries and intra-body `div`/`p`/`br` markers as paragraph boundaries, retains annotation attributes, and preserves textual correction alternatives with explicit “superseded text” / “replacement text” labels. Scripts, styles, embedded documents and executable SVG/MathML subtrees are suppressed. DTD/entity declarations are rejected. Provider hyperlinks and event attributes never become output links or attributes. Unknown tags remain recorded as uninterpreted metadata, not silently declared understood. [Implementation](issue-19-probes/extract_articles.py), [output](issue-19-probes/article-extraction-results.json).

Real wire records **`161686.05`, `161686.30`, `161686.40`, `161686.45` are not well-formed XML** under the standard parser. The extracted output records that failure. The tolerant tokenizer operates on inert strings inside the recognised envelope, never a DOM; the observed `srś` tag and other unknown tags remain warnings/annotations. This recovers the supplied textual material but does not prove that every nontext Sanskrit junction, accent, correction or unfamiliar structural marker has been rendered with its intended semantics. No silent repair or complete-readability claim is made. [Original `mA` response](issue-19-probes/c_getword_xml_homograph.json), [validation summary](issue-19-probes/article-extraction-results.json).

[edge_render.py](issue-19-probes/edge_render.py) renders the resulting strings in an ordinary page in actual Edge using research-owned elements and `textContent`, with revalidated fixed-origin HTTPS source anchors. All 36 records, their extracted paragraphs and attribution survive. Active-content and literal-markup controls pass; no provider code executes, and HTTP(S) networking is blocked for this local render test. Source links are built from validated string IDs and a fixed documented native endpoint. They are safe **record references**, not verified full-article permalinks, and were not followed. [Actual Edge result](issue-19-probes/edge-render-results.json), [renderer](issue-19-probes/edge_render.py).

This is a concrete Python-plus-research-Edge boundary, consistent with the text-and-links approach of [ADR 0008](../adr/0008-dictionary-articles-as-text-and-links.md); it is **not production TypeScript**, universal sanitization proof, or complete article acceptance. Required future work is a fail-closed production record parser/extractor with validated handling for the full deployed tag vocabulary, accurate paragraph/content semantics and complete selected article groups. The release must not use this experiment's successful text rendering to conceal missing parent/continuation content. [Research limitations in output](issue-19-probes/article-extraction-results.json), [#19 acceptance](https://github.com/YoukouTenhouin/Tensho/issues/19).

Attribution is retained as “Monier-Williams Sanskrit-English Dictionary (1899), Cologne Digital Sanskrit Dictionaries,” together with the provider, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and a transformation notice. Raw fixtures are unchanged historical bodies; derived JSON separates records, extracts text and removes markup. The pinned canonical-data license is distinct from a hosted service request allowance and does not establish every separately served artifact's rights. Preserve session-only result retention; exact deployed data and response conditions remain #21 work. [License][license], [fixture notices](issue-19-probes/article-provenance.json), [ADR 0007](../adr/0007-session-only-reading-results.md).

## Outcome and fallback contract

| Observation | Adapter outcome |
| --- | --- |
| Valid canonical key response containing dictionary possibilities, but correspondence unknown | Preserve analysis, show unranked alternatives only once their article boundaries are validated, require learner selection; no automatic fallback for uncertainty. |
| Recognised endpoint JSON with `status:404`, empty `xml`/`html` for an eligible request | Endpoint lookup miss / unresolved dictionary mapping; does not prove dictionary-wide absence. |
| Unsupported/unknown input scheme | Unsupported request/capability; do not interpret an alias silently defaulting to SLP1 as a lexical miss. |
| 403, 429, 500, empty/malformed/incompatible response, timeout, size bound or mismatched selected identity | Technical failure, retaining analysis and any usable partial result. Protection is never a dictionary miss. |
| Technical retrieval failure before any article has succeeded for the candidate | Advance to the next eligible provider under the established lazy fallback rule. An indexed alternative is not a successful article. |
| Technical failure after one article has succeeded | Keep that usable partial result and report the later failure; do not consult another provider merely to fill gaps. |

These rules follow [ADRs 0001](../adr/0001-separate-analysis-and-dictionary-roles.md), [0005](../adr/0005-preserve-uncertainty-in-dictionary-mapping.md), [0009](../adr/0009-lazy-dictionary-retrieval-and-fallback.md), the [historical miss/alias cases][old-results], and the [fresh 500](issue-19-probes/edge-access-results.json). No confirmed dictionary-wide absence or working production fallback chain was established here.

## Alternative and operator questions

The first-party C-SALT repository links hosted MW REST and GraphQL at `https://api.c-salt.uni-koeln.de/dicts/mw/…`. Its MW mapping indexes `//tei:entry`, uses `./@xml:id` as identity, and separately indexes primary SLP1 forms, senses and run-on headwords under `tei:re`. This makes a **full TEI entry with nested material and explicit identity** a credible investigation target. A top-level-headword-only search could still miss compound/run-on alternatives; preserve all candidate identities and require explicit article retrieval and content validation. The README's entry count is an operator claim, not a completeness metric or a fresh deployment measurement. [README][csalt], [MW mapping][mapping].

The native project's Salt wrapper is a different surface from that existing C-SALT host. Its repository describes per-record IDs and partially populated fields, while the current guide labels its deployment roadmap. Do not substitute a clean-URL or `salt_entries` example for an established current request path. No replacement passes on source inspection alone; C-SALT still needs permitted accountless actual-Edge access, ID verification, full `mA`/`Darmakzetra`/ordinary-entry coverage, source comparison, safe extraction and quota/terms evidence. [Native Salt documentation][salt], [current guide][guide], [C-SALT operator][csalt].

Prepare these questions for the native Cologne operator through its official project contact/issue channel, and for C-SALT through the operator-listed `info-csalt@uni-koeln.de` if that alternative proceeds. **No outreach was sent**:

1. Can the operator correlate the native `agni` GET at `2026-10-05T02:35:20.113Z` with its logs and identify who emitted the empty 500/`Varnish` response? Is actual Edge MV3, without cookies or credentials, a supported client?
2. Is this accountless extension use with explicit learner-triggered lookups and session-only retention permitted? What attribution, response-storage and derivative-display conditions apply to the deployed content?
3. What numeric request/concurrency budgets, cooldown and `Retry-After` behavior apply, including shared egress? What paired diagnostic requests, if any, may be made after the previous 429/500 evidence?
4. Which code commit, dictionary snapshot and content licenses are deployed? Is a versioned record/whole-article retrieval contract available, including inherited parents, phrasal children, revisions and decimal IDs?
5. For C-SALT, does retrieval by `xml:id` retain the complete nested entry and run-ons, and which search contract finds a compound/run-on without flattening or conflating homographs?

The unresolved conditions belong to [#21](https://github.com/YoukouTenhouin/Tensho/issues/21), and its explicit separate-outreach authorization rule remains in force. The C-SALT recipient is published in its [operator README][csalt].

## Dated acceptance gates

| #19 gate, assessed 2026-10-05 | Result | Remaining requirement |
| --- | --- | --- |
| Allowed accountless hosted path from actual Edge MV3 | **Unresolved / observed failure** | One fresh permitted GET returns empty 500. Operator-supported access and terms are not established. [Evidence](issue-19-probes/edge-access-results.json). |
| Client discrepancy, permissions/CORS, bounds and budget | **Partial** | Exact request/response and permission revocation recorded; local bounds defined. Root cause, numeric provider quota, deployed versions and current Python comparison remain unresolved. [Harness](issue-19-probes/edge_access.py), [#21](https://github.com/YoukouTenhouin/Tensho/issues/21). |
| Full boundaries and retrieval by identity | **Unresolved** | All seven required H-code forms and 36 records retained; single-record selection source understood. Complete parents/children/revisions, representative source-scan comparison and live selected-article verification remain absent. [Boundaries](issue-19-probes/article-boundaries.json). |
| Uncertain alternatives and analyzer suffix separation | **Contract established; resolver unvalidated** | No first-record/ranked/number-equality selection. Full correspondence remains unknown; learner selection required. [#18](sanskrit-analyzer-contract.md), [ADR 0005](../adr/0005-preserve-uncertainty-in-dictionary-mapping.md). |
| Miss/unsupported/failure distinction | **Contract established from historical + fresh evidence** | Fresh 500 is technical; historical endpoint miss is unresolved mapping. No dictionary-wide absence asserted. [Historical results][old-results], [fresh failure](issue-19-probes/edge-access-results.json). |
| Inert full readable article rendering | **Partial** | Offline extraction and actual Edge safe text rendering pass for retained material. Nontext semantics, malformed XML, unknown tags and missing article context prevent full-entry acceptance; production TypeScript still required. [Extraction](issue-19-probes/article-extraction-results.json), [Edge](issue-19-probes/edge-render-results.json). |
| Reproducible evidence and alternative | **Research deliverable complete** | Saved requests, hashes, full historical fixtures, grouping hypotheses, extraction and actual Edge checks; C-SALT identified but unvalidated. [Provenance](issue-19-probes/article-provenance.json), [alternative source][csalt]. |

This investigation can be recorded as completed research with unresolved results; closing a research ticket does not pass Sanskrit readiness or reduce the agreed passage-analysis scope. The concrete next step is the #21 access/data clarification, followed by bounded native repair validation or C-SALT investigation under its established service conditions, then the full passage → constituent → selected complete article workflow in [#22](https://github.com/YoukouTenhouin/Tensho/issues/22).

## Reproduction

The following checks are offline and do not request dictionary data:

```sh
python3 docs/research/issue-19-probes/edge_access.py
python3 docs/research/issue-19-probes/extract_articles.py > /tmp/issue19-extraction.json
python3 docs/research/issue-19-probes/edge_render.py --output /tmp/issue19-render.json
```

Compare generated extraction JSON with the retained `article-extraction-results.json`. The browser render check uses actual local Edge and blocks outbound HTTP(S). The access harness defaults to checking saved evidence; its live mode is deliberately separate. **Do not replay live requests automatically or in CI** after the recorded failure. Resolve permitted diagnostics through #21 first; links and historical fixtures here are evidence, not a retry instruction. [Access harness](issue-19-probes/edge_access.py), [render harness](issue-19-probes/edge_render.py).

[history]: https://github.com/YoukouTenhouin/Tensho/blob/5edfa389d9eed6fefe88184648355a709aae7f68/docs/research/sanskrit-integration.md
[old-results]: https://github.com/YoukouTenhouin/Tensho/blob/5edfa389d9eed6fefe88184648355a709aae7f68/docs/research/issue-11-probes/provider-results.json
[guide]: https://github.com/sanskrit-lexicon/csl-guides/blob/9ec981f02c741b66cf255f1ddc07bcbd48dc10d0/docs/developers/api.md
[xmlclass]: https://github.com/sanskrit-lexicon/csl-apidev/blob/633fcb1a49fd57329d3f9f3e92da5be426759006/getwordXmlClass.php
[xmldoc]: https://github.com/sanskrit-lexicon/csl-apidev/blob/633fcb1a49fd57329d3f9f3e92da5be426759006/doc/getword_xml.md
[dal]: https://github.com/sanskrit-lexicon/csl-apidev/blob/633fcb1a49fd57329d3f9f3e92da5be426759006/dal.php
[display]: https://github.com/sanskrit-lexicon/csl-apidev/blob/633fcb1a49fd57329d3f9f3e92da5be426759006/getwordClass.php
[entryguide]: https://github.com/sanskrit-lexicon/MWS/blob/ced58ea7a5c2c1faec2eab8cc302fc5d3199f172/ENTRY_GUIDE.md
[datadict]: https://github.com/sanskrit-lexicon/MWS/blob/ced58ea7a5c2c1faec2eab8cc302fc5d3199f172/DATA_DICTIONARY.md
[dtd]: https://github.com/sanskrit-lexicon/csl-pywork/blob/8e00691fd63ab406927c66cf20437200558eca60/v00/distinctscripts/MWScan/2020/pywork/mw.dtd
[license]: https://github.com/sanskrit-lexicon/csl-orig/blob/55e8addbd96e8d9001b8789026b026763f4049c1/LICENSE
[csalt]: https://github.com/cceh/c-salt_sanskrit_data/blob/cb06c4cfc80c3afa38bee9b87120b06f2ebbd9e0/README.md
[mapping]: https://github.com/cceh/c-salt_sanskrit_data/blob/cb06c4cfc80c3afa38bee9b87120b06f2ebbd9e0/sa_en/mw/split/mw_mapping.json
[salt]: https://github.com/sanskrit-lexicon/csl-apidev/blob/633fcb1a49fd57329d3f9f3e92da5be426759006/doc/salt_entries.md
