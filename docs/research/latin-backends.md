# Latin backend feasibility

Research date: 2026-10-04. Context: [Investigate Latin lemmatization and dictionary backends](https://github.com/YoukouTenhouin/Tensho/issues/2).

## Finding

A Latin-first extension is feasible without an account or paid API. The strongest hosted candidate is Alpheios's Whitaker morphology service paired with its Lewis & Short dictionary service. Standalone Whitaker and Collatinus are credible alternatives when control, offline use, or different dictionaries justify an additional deployment step. This is a shortlist, **not a final default selection**.

The extension should treat analysis and dictionary retrieval as separate capabilities even when one configured provider offers both. That is a planning inference from the separate services and data formats below.

## Candidates

| Candidate | Documented capability | Language and explanations | Integration assessment |
| --- | --- | --- | --- |
| Alpheios hosted morphology | Explicit Latin engine; candidate headwords, morphology, and short meanings. Separate dictionary adapter supports full entries. | Latin lookup is explicit; Whitaker glosses and configured Lewis & Short dictionary are English. | Best online candidate. Small sample lookups succeeded without credentials; no Edge integration tested. |
| Standalone Whitaker's WORDS | Latin-English lexical and inflection data; command-line operation defaults to Latin, with a separate English mode. | Configure only Latin mode. English output does not imply English-word lookup. | Free local engine, not itself an extension-compatible hosted JSON API. Needs a wrapper, port, or packaged runtime. |
| Collatinus | Latin word/text lemmatization, morphology, dictionary lookup, inflection tables; ranked analyses using LASLA frequencies. | English/French and other dictionary choices; Latin source language. | Strong local/server alternative. Its internal server/console integration is documented; a stable public browser API was not established here. |
| Perseus lexical data | Downloadable encoded lexica, with per-file credits. | Dictionary-dependent; useful for Latin dictionary entries. | Dictionary material, not a complete lemmatizer or a proven hosted API. Useful if building a controlled dictionary backend. |

Sources: [Alpheios adapter documentation](https://github.com/alpheios-project/alpheios-core/tree/master/packages/client-adapters), [Whitaker operational documentation](https://mk270.github.io/whitakers-words/operational.html), [Collatinus project documentation](https://outils.biblissima.fr/en/collatinus/), [Perseus lexica repository](https://github.com/PerseusDL/lexica).

## Exact Alpheios integration evidence

The current [morphology configuration](https://github.com/alpheios-project/alpheios-core/blob/master/packages/client-adapters/src/adapters/tufts/config.json) maps `lat` to `whitakerLat`. Its request template is:

```text
https://morph.alpheios.net/api/v1/analysis/word?word=WORD&engine=whitakerLat&lang=lat&clientId=CLIENT
```

The [dictionary configuration](https://github.com/alpheios-project/alpheios-core/blob/master/packages/client-adapters/src/adapters/lexicons/config.json) identifies Lewis & Short with `source: lat`, `target: en`, a lemma-ID index, and an HTML full-entry endpoint. The Latin short-definition dictionary URL is null in this configuration: short glosses already arrive with the Whitaker morphology response. Do not assume the README's short/full table is a precise current contract. Follow the adapter and index behavior when resolving full entries; arbitrary string substitution for a lemma ID has not been verified.

Explicit language and engine fields make extension-owned lookup-language isolation practical. They do not guarantee that upstream content is correct, nor is filtering upstream linguistic mistakes part of this effort.

## Reproducible samples and live observations

Two `curl` requests succeeded on the research date without account credentials. These are service observations, not accuracy certification or an uptime benchmark:

| Input | Observed response |
| --- | --- |
| `important` | Latin headword `importo, importare, importavi, importatus`; present active indicative, third-person plural; English gloss describing bringing in/importing/causing. No English adjective entry was observed. |
| `puellae` | Headword `puella, puellae`; five analyses: genitive, locative, and dative singular, plus nominative and vocative plural. This illustrates preserving provider ambiguity, including less usual analyses. |

Reproduce either result by changing only `word`:

```sh
curl --get 'https://morph.alpheios.net/api/v1/analysis/word' \
  --data-urlencode 'word=important' \
  --data-urlencode 'engine=whitakerLat' \
  --data-urlencode 'lang=lat' \
  --data-urlencode 'clientId=tensho-research'
```

Responses were JSON-shaped RDF annotations. `infl` was an object for `important` and an array for `puellae`; normalization must handle both. The responses include a rights field crediting William Whitaker. [Reproducible important query](https://morph.alpheios.net/api/v1/analysis/word?word=important&engine=whitakerLat&lang=lat&clientId=tensho-research), [reproducible puellae query](https://morph.alpheios.net/api/v1/analysis/word?word=puellae&engine=whitakerLat&lang=lat&clientId=tensho-research).

Additional acceptance probes should include `legi` (ambiguity), `amaverunt` (inflection), `mālum` versus `malum` (normalization), and `zzqxx` (missing result). Their linguistic results are not established here. An attempted Python JSON client did not parse its responses; content negotiation/response shape needs explicit testing during integration. No claim is made that successful curl responses prove browser operation.

## Licensing, access, and operational limits

- **Alpheios:** public API terms permit documented access but allow limits, future credentials, access blocking, and incompatible changes. They provide no availability guarantee. Preserve actual client identity and provider attribution. Accountless calls working today are evidence, not an indefinite access commitment. [API terms](https://alpheios.net/pages/apiterms/)
- **Whitaker:** the `spr93` maintained fork publishes BSD-2-Clause terms covering its distribution, with notices required on redistribution; it also explains the original author's permissive wording. If selected, pin the exact fork/version and retain its notices. Do not assume every fork has identical terms. [Fork licensing statement](https://github.com/spr93/whitakers_latin_words)
- **Collatinus:** project source is GPLv3; downloadable dictionaries have distinct provenance and permissions. Its documentation lists English, French, German and other dictionaries, including image-based dictionaries. A dictionary available in the desktop app is not automatically a machine-readable browser backend. [Project and dictionary catalog](https://outils.biblissima.fr/en/collatinus/), [source/license](https://github.com/biblissima/collatinus)
- **Perseus:** repository default is CC BY-SA 4.0 unless indicated otherwise; check individual file credits and exceptions when bundling or adapting data. [Repository reuse statement](https://github.com/PerseusDL/lexica)
- **Browser access:** Chromium extension service workers can make cross-origin requests with host permissions; content scripts remain subject to the page's same-origin restrictions. Route provider requests through the extension context. This is documented platform feasibility, not a completed Edge test. [Chrome network documentation](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

No fixed quota, provider SLA, comprehensive dialect coverage, or comparative accuracy benchmark was established. A controlled sample drawn from the user's Latin reading should decide suitability; preserve alternative analyses and distinguish no match from service failure.

## Decision supported

Shortlist Alpheios first for the online route; retain standalone Whitaker for controllable deployment and Collatinus for broader dictionary/local-tool needs. The next decision should choose the default provider combination and acceptable deployment burden, with a small integration check for response formats, full dictionary retrieval, permission behavior, and attribution. Explanation language should describe actual provider capability: these English glosses satisfy Latin lookup isolation but are not Latin-only explanations. Sanskrit support is a separate investigation.
