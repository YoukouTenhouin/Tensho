# Sanskrit backends and input requirements

Research date: 2026-10-04. Decision question: [Investigate Sanskrit backends and input requirements](https://github.com/YoukouTenhouin/Tensho/issues/3).

## Recommendation

Shortlist **Cologne Digital Sanskrit Dictionaries (CDSL), initially Monier-Williams**, for dictionary meanings, and **Sanskrit Heritage** for morphological analysis and segmentation. Evaluate **sanskrit_parser** as an alternative morphology adapter where a structured REST interface is preferable. These are candidate combinations, not a final provider selection or a Sanskrit rollout commitment.

Do not promise that an arbitrary double-clicked Sanskrit span is one complete inflected word. Preserve the selected text and allow multiple analyses or segmentations. The user has not supplied Sanskrit reading samples or scripts; Devanagari and IAST are evaluation inputs, not established user requirements.

## Candidate comparison

| Candidate | Useful capability | Access and integration assessment |
| --- | --- | --- |
| CDSL native API | Dictionary entries by headword; candidate meanings after an analyzer supplies lemmas | Best dictionary shortlist candidate. Accountless API is documented; most established entry output is HTML, not a clean senses object. |
| Sanskrit Heritage | Stemming, morphology, sandhi segmentation, linked dictionaries | Strong linguistic candidate. Public web interfaces and downloadable resources exist, but automated access and response extraction need validation. |
| sanskrit_parser | Word tags, sandhi splits, sentence analysis | Structured REST implementation and self-hostable Python library. Public service suitability and data-license inventory remain integration questions. |

### CDSL: meanings rather than a general lemmatizer

The native API documents `getword` for headword entries, `getsuggest` for prefixes, and `servepdf` for scans. Its reference calls the interface a well-tested beta, and says most responses are HTML. These operations should not be represented as inflected-form analysis or sandhi splitting. [API implementation documentation](https://github.com/sanskrit-lexicon/csl-apidev/blob/main/doc/readme.md)

The current guide documents free access without authentication or API keys and wildcard CORS. It lists `getword_xml` as alpha and Salt endpoints/clean URLs as roadmap; another section describes Salt operation, so conservatively do not rely on that surface before checking deployment. `input`/`output` include `slp1`, `deva`, `hk`, `itrans`, and `roman`. Explicitly specify the scheme: defaults differ by endpoint. The guide also uses an `iast` output example, making accepted aliases worth checking. [Provider API guide](https://sanskrit-lexicon.github.io/csl-guides/developers/api)

Monier-Williams supplies Sanskrit–English meanings; other dictionaries provide different explanation languages. Choose a Sanskrit-source dictionary explicitly, rather than assuming every dictionary in the catalog has that direction. C-SALT's own documentation includes Sanskrit–English Monier-Williams, Sanskrit–German Böhtlingk–Roth, and English–Sanskrit Apte; the latter is the wrong direction for selected Sanskrit forms. [C-SALT implementation](https://cceh.github.io/kosh/docs/implementations/c-salt_sanskrit.html)

CDSL's canonical source-data repository carries CC BY-SA 4.0. Preserve attribution and track the data version when caching or distributing derived dictionary content. This is a data-license finding, not a claim that every API implementation or historical dictionary artifact has the same license. [Data license](https://github.com/sanskrit-lexicon/csl-orig/blob/main/LICENSE)

### Sanskrit Heritage: morphology with explicit ambiguity

The Reader accepts IAST, Devanagari, Velthuis, Kyoto-Harvard, WX, and SLP1, with IAST/Devanagari display. It returns competing segmentations and morphological analyses, with links to French Heritage or English Monier-Williams meanings. The standalone Stemmer requires a lexical category and distinguishes such banks as nouns, participles, and compound components; a blanket call to one category would lose analyses. [Heritage reference manual](https://sanskrit.uohyd.ac.in/SKT/manual.html)

Heritage morphology downloads provide tagged forms in WX and SLP1. Their scope is classical Sanskrit; the resource documentation identifies omitted verbal categories, incomplete compound constructions, and both missing and excessive analyses. It also distinguishes the tagger's treatment of prefixed verbs from the standalone stemmer. Thus a morphology-table lookup alone does not replace segmentation. The linguistic resources are licensed under **LGPLLR**, not ordinary LGPL; review the linked terms for the exact data package before redistribution. [Linguistic resources](https://sanskrit.uohyd.ac.in/SKT/xml.html)

Dictionary artifacts have separate terms: the Golden Heritage page describes older 2014 dictionary packages under **CC BY-NC 4.0**. Do not carry the morphology license over to French dictionary text or assume these older downloadable files equal the current service. [Dictionary downloads and terms](https://sanskrit.uohyd.ac.in/SKT/goldendict.html)

Observed during research: opening the INRIA homepage and manual through the web tool returned an Anubis access-denied page. The University of Hyderabad mirror's manual and resource pages were readable. This does not prove an Edge user or an extension request will be blocked, or that the mirror's analysis endpoints work. It makes automatic access a concrete feasibility check before choosing a default. [Observed INRIA entry point](https://sanskrit.inria.fr/index.en.html)

The public web workflow appears accountless; this review found no structured JSON contract, service-level guarantee, or confirmed CORS policy for Heritage. Prefer a separately tested adapter or a source-page link over pretending its HTML interface is a stable API.

### sanskrit_parser: structured alternate, with boundaries

The project provides a Python package and advertises a public REST service. It warns explicitly of invalid and missing forms/splits. Its morphology layer incorporates Heritage and sanskrit_data resources; the repository's MIT code license does not establish the license of every incorporated dataset. [Project README](https://github.com/kmadathil/sanskrit_parser)

The REST source contains `/v1/tags/<string:p>` and `/v1/splits/<string:v>`. Tags serialize lexical bases and morphological tags; splits return at most ten paths, with Devanagari output. They do not supply dictionary definitions, so a dictionary provider is still needed. The service constructs Sanskrit objects without an explicit input scheme in these endpoints: verify accepted encodings against the deployed version, rather than inferring the HTTP contract from the Python library. [REST implementation](https://raw.githubusercontent.com/kmadathil/sanskrit_parser/master/sanskrit_parser/rest_api/api_v1.py)

Its library accepts explicit input/output encodings, illustrated with SLP1. Its segmentation model represents alternative paths, and documentation distinguishes word-level tags, phrase splitting, and sentence analysis. This is a useful separation for the extension's backend capabilities. [Library interface](https://kmadathil.github.io/sanskrit_parser/build/html/sanskrit_parser_code.html), [Segmentation documentation](https://sanskrit-parser.readthedocs.io/en/latest/sanskrit_parser_doc.html)

The hosted API is a candidate, not an operationally verified default: this investigation did not test availability, Edge access, CORS, usage limits, or response consistency. Self-hosting is an available architectural option, not a requirement accepted by the user.

## Planning consequences

These recommendations are inferences from the capabilities above:

- Model analysis and dictionary lookup separately. Keep each candidate lemma, grammatical analysis, segmentation, and provider provenance rather than flattening them into one guessed answer.
- Keep lookup language fixed to Sanskrit throughout that pipeline. Dictionary explanation language and display script are independent settings; English meanings of Sanskrit words do not constitute English word lookup.
- Preserve original Unicode, diacritics, and whitespace. Convert only through an explicit provider-specific input scheme. Do not treat Latin script as evidence of Latin lookup language.
- Permit an intentional longer selection for sandhi analysis; do not silently collect surrounding sentences. Sandhi splitting and interpretation of a compound are distinct capabilities, and neither guarantees one correct reading.
- Before Sanskrit provider selection, obtain real reading examples and assess the exact API/mirror using those inputs, including an ambiguous form, a sandhied span, a compound, and an unknown form. Check accountless access, output parsing, source links, and license attribution for the chosen combination.

## Evidence limits

This is primary-source feasibility research, not an implementation or quality benchmark. Only documentation retrieval and the INRIA access-denied response were observed live. No lookup endpoint was exercised from Edge. No claim of production availability, unrestricted usage, complete Sanskrit coverage, or tested end-to-end lemmatization is made.
