# English provider contract

Research date: **2026-10-07**. Addresses [#43](https://github.com/YoukouTenhouin/Tensho/issues/43) and [#44](https://github.com/YoukouTenhouin/Tensho/issues/44). This report proposes an English lexical reading aid with possible base forms and Simplified Chinese dictionary explanations. Contextual parsing, exhaustive grammar, machine translation, accounts and user-operated servers are unnecessary for this scope. [Repository terminology](../../CONTEXT.md), [role separation](../adr/0001-separate-analysis-and-dictionary-roles.md), [explanation eligibility](../adr/0002-explanation-preferences-and-provider-eligibility.md).

## Recommended providers

Use **bundled Princeton WordNet 3.0 lemma indexes and morphology exception lists**, with extension-owned conservative rules and a small function-word supplement, for structural analysis. Use the **official Chinese Wiktionary MediaWiki Action API**, requesting provider-native `variant=zh-hans`, for lazily retrieved English-section articles. WordNet supplies possible lexical bases, not Chinese definitions or a context-sensitive grammatical verdict. The Chinese service supplies its own Simplified Chinese rendering; Tensho need not translate or convert provider text. [Princeton morphology documentation](https://wordnet.princeton.edu/documentation/morphy7wn), [live dictionary investigation](english-wiktionary-probes/provider-results.json).

This is a deliberate research proposal to extend [issue #1](https://github.com/YoukouTenhouin/Tensho/issues/1)'s hosted-provider scope to **extension-bundled static lexical data**. It introduces neither arbitrary provider URLs nor an external local executable. Approval of that architecture belongs in the implementation specification; this research does not silently change an ADR. Offline analysis remains usable when dictionary access fails, as required by [ADR 0001](../adr/0001-separate-analysis-and-dictionary-roles.md).

## Acquired artifact and executable evidence

One official download, bounded to 15 MB, succeeded:

```text
https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz
bytes: 11537239
SHA-256: 640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52
```

The research extracted only `LICENSE`, four `dict/index.*` files and four `dict/*.exc` files by explicit member names, without extracting archive paths. [Probe source](english-wordnet-probes/probe.py) records every selected file's SHA-256 in [results](english-wordnet-probes/provider-results.json). Reproduce against an independently acquired archive:

```sh
python3 docs/research/english-wordnet-probes/probe.py /tmp/WordNet-3.0.tar.gz
```

Removing index offsets/counts and retaining lemma spellings, POS groups and exception mappings produced **2,347,086 JSON bytes**, **698,907 gzip bytes**. Counts are 117,798 noun, 11,529 verb, 21,479 adjective and 4,481 adverb index keys; counts include collocations and overlapping spellings. This establishes bounded packaging feasibility, not browser startup or memory performance. The production build must deterministically generate and hash its final asset and lazy-load analysis data when English is first used. No complete WordNet definitions or downloaded dictionary database belongs in this research change. [Measured results](english-wordnet-probes/provider-results.json).

Princeton's license permits copying, modifying and distributing the database for any purpose without a fee, provided its copyright, license conditions and disclaimer accompany all copies; it restricts promotional use of Princeton's name. Ship the archive's complete `LICENSE` with the derived asset and identify the source/version in provider attribution. The downloaded license has SHA-256 `7731175a77952e259390b496fab905e57118b8d19ad3a8383c67eee724ff443f`. [Official license](https://wordnet.princeton.edu/license-and-commercial-use), [artifact evidence](english-wordnet-probes/provider-results.json).

## Analysis semantics

The research probe checks exact index membership, exception mappings and documented suffix transformations against the index for each POS, retaining all results. It intentionally exposes ambiguity. WordNet requires index validation after transformation and documents imperfect treatment of collocations and possible nonword transformations. Our bounded probe is **not the full Princeton Morphy implementation**. [Morphy](https://wordnet.princeton.edu/documentation/morphy7wn), [probe](english-wordnet-probes/probe.py).

| Selected form | Evidence found | Contract consequence |
| --- | --- | --- |
| `saw` | Exact noun/verb `saw`; exception verb `see` | Retain both bases; no automatic semantic choice. |
| `went`, `children`, `mice` | `go`, `child`, `mouse` exceptions | Base and POS supported; exception files alone do not encode detailed tense/person. |
| `leaves` | Nouns `leaf`, `leave`; verb `leave` | Preserve noun/verb alternatives. |
| `axes` | Nouns `ax`, `axis`, `axe`; verbs `ax`, `axe` | Suffix and exception evidence remain distinct; do not rank by meaning. |
| `better` | `better` in several POS; `good` and `well` exceptions | Several lexical candidates remain plausible. |
| `running` | Exact noun/adjective; verb `run` exception | Do not claim every selection is a progressive verb. |
| `reading`, `read` | Several noun/verb paths | No pronunciation or contextual tense inference. |
| `color`, `colour` | Both recognized separately | Preserve spelling, do not silently rewrite dialect. |
| `look up`, `state-of-the-art` | Exact verb collocation/adjective | Phrase support requires explicit phrase UI policy. |
| `the`, `don't`, `he's` | No WordNet match | Use reviewed supplement or report structural analysis unavailable. |
| `I`, `a`, `is`, `was` | Lowercasing/suffixes produce unrelated letter/abbreviation bases | Preserve selected case; no assertion that these readings describe the sentence. |

Every row is a bounded observation, not a coverage statistic. [27-form results](english-wordnet-probes/provider-results.json).

Group candidates by spelling and source identity rules already used in Tensho, with POS/evidence interpretations attached. A WordNet lemma key is not the identity of a Chinese Wiktionary article. Dictionary resolution remains uncertain until a matching English section is identified; preserve [ADR 0005](../adr/0005-preserve-uncertainty-in-dictionary-mapping.md) and [ADR 0009](../adr/0009-lazy-dictionary-retrieval-and-fallback.md).

Only emit supported fields: POS from the lexical source; an independently reviewed morphological label where available. Generic `-ed` can be past or past participle; `-ing` has several functions; noun plural suffixes and comparison suffixes are proposals. Do not infer person, tense, countability or sense from a suffix alone. A WordNet lexical miss means analysis unavailable from that vocabulary, not that the selected English word does not exist. [Observed misses](english-wordnet-probes/provider-results.json), [uncertainty policy](../adr/0005-preserve-uncertainty-in-dictionary-mapping.md).

## Small supplement and selected-form lookup

The following is an **extension-authored factual mapping specification**, not copied dictionary prose. Cite grammar references in its development notes; Chinese interface labels remain extension-authored translations. The supplement fills common function-word gaps, rather than importing ECDICT's ambiguously licensed morphology data.

| Form | Minimum facts permitted |
| --- | --- |
| `a`, `an`, `the` | Same selected headword; article/determiner. No sentence-level definiteness inference. |
| `I` | Same case-preserved headword; personal pronoun, first person singular, subject form. |
| `you` | Personal pronoun, second person; retain singular/plural and subject/object possibilities. |
| `am`, `is`, `are` | Candidate `be`; present forms; `am` first singular, `is` third singular, `are` other ordinary present forms. |
| `was`, `were`, `been`, `being` | Candidate `be`; past-form/past-participle/ing-form respectively; avoid exhaustive mood claims. |
| `don't` / `don’t` | Recognized contraction of `do not`; retain the contraction article as selected-form lookup; optional component bases `do` and `not` are components, not a single lemma. |
| `he's` / `he’s` | Two expansions `he is` and `he has`; keep both. Component bases `he` + `be`/`have` must remain separate expansion alternatives. |
| `I'm`, `you're`, `we're`, `they're`, `I've`, `we've`, `they've`, pronoun + `'d`/`'ll` | Explicit reviewed expansion table; `'d` retains `had`/`would`, `'ll` maps `will`. Unlisted apostrophe forms do not use generic possessive stripping. |

Sources: [Cambridge articles](https://dictionary.cambridge.org/grammar/british-grammar/a-an-and-the), [personal pronouns](https://dictionary.cambridge.org/us/grammar/british-grammar/pronouns-personal-i-me-you-he-it-they-etc), [be forms](https://dictionary.cambridge.org/grammar/british-grammar/be), [apostrophe/contraction ambiguity](https://dictionary.cambridge.org/grammar/british-grammar/contraction), [contractions](https://dictionary.cambridge.org/grammar/british-grammar/contractions). This table is proposed production work, not already implemented or mechanically validated.

Normalize NFC, surrounding whitespace and curly apostrophes for lookup keys while preserving displayed input; do not erase internal apostrophes/hyphens or silently lowercase proper-name input. The implementation should offer a **selected-form dictionary lookup when analysis is unavailable**. Represent that spelling as an unresolved selected form with unknown lemma identity, rather than claiming an analyzer discovered a lemma. Its dictionary result is valid only after checking the page's English section. This requires a small explicit result-model/UI extension; it prevents ordinary English words outside WordNet's inventory from being rejected before dictionary lookup. [Role separation](../adr/0001-separate-analysis-and-dictionary-roles.md), [dictionary experiment](english-wiktionary-probes/provider-results.json).

Contraction expansion is optional v1 explanatory detail. Recognizing the entire contraction and offering its original headword lookup is sufficient for initial scope; do not split it into unrelated Latin-style candidate lemmas. General phrase segmentation, phrasal-verb parsing and syntax trees remain later features. An exact phrase lookup may be offered separately without interpreting arbitrary multiword selections as one lemma. These are scope recommendations, not claims of exhaustive English analysis.

## Dictionary eligibility and licensing

Expose `zh-Hans` explanation eligibility for the hosted Chinese dictionary and structural-only eligibility for the bundled analyzer; missing short meanings stay explicitly unavailable. English lexical bases and source POS can still appear beside Chinese interface field labels; extension-authored proposed interpretation labels may themselves be localized. Dictionary service failures leave the analysis usable. Use the API contract in [the dictionary probe](english-wiktionary-probes/provider-results.json) and the [separate Edge evidence](english-wiktionary-probes/edge-access-results.json); availability observed once is not an SLA or unlimited request allowance. [ADR 0002](../adr/0002-explanation-preferences-and-provider-eligibility.md).

Chinese Wiktionary's rendered article footer identifies CC BY-SA 4.0. Preserve article attribution, a source/history link, license link and a notice of extraction/omitted site furniture. Provider-native `zh-hans` rendering is preferable to locally rewriting authored definitions. A bundled Wiktionary-derived dataset would separately require share-alike licensing of the adapted data and a documented attribution/acquisition chain. Avoid audio/images/quoted examples with separate rights unless independently vetted. [Chinese article and license footer](https://zh.wiktionary.org/zh-hans/saw), [Wikimedia content licensing terms](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content).

## Alternatives assessed

**ECDICT** is attractive technically but is not the release default. At pinned commit `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`, `lemma.en.txt` is 2,318,694 bytes (SHA-256 `e255b097404e3e0052060e2ddf6e15a1414f577071d63d51d2ca0ce9dacee0fc`) and its header limits its stated free-use permission to research/educational purposes. Its repository MIT notice does not resolve that embedded statement or all contributed definition sources. The README describes mixed acquired/scraped material. Do not import the data until source rights are resolved. Its exchange fields could support inflections, but no production dependence is necessary. [Pinned lemma file](https://github.com/skywind3000/ECDICT/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/lemma.en.txt), [license](https://github.com/skywind3000/ECDICT/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/LICENSE), [README](https://github.com/skywind3000/ECDICT/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/README.md).

**Kaikki/Wiktextract** is a legitimate offline alternative. Chinese-edition pages split English into `英語` (74,521 distinct words; 60.2 MB JSONL) and `英语` (14,174 words; 20.9 MB). Labels are not evidence that every gloss uses that script. Raw Chinese extraction is 223.6 MB compressed across hundreds of languages; the smaller website datasets are deprecated and postprocessed with additional sources. No such bulk files were fetched. Use future raw `lang_code == 'en'` filtering with preserved sources and explicit conversion policy if offline dictionary scope is requested. [Traditional-labelled subset](https://kaikki.org/zhwiktionary/%E8%8B%B1%E8%AA%9E/index.html), [simplified-labelled subset](https://kaikki.org/zhwiktionary/%E8%8B%B1%E8%AF%AD/index.html), [raw extraction](https://kaikki.org/zhwiktionary/rawdata.html), [license](https://kaikki.org/zhwiktionary/).

**Free Dictionary API** documents an `/entries/en/` endpoint with English meanings; it does not establish a Chinese explanation contract and cannot satisfy this learner's requested explanations. [Operator documentation](https://dictionaryapi.dev/).

**Cambridge** expressly offers its Advanced Learner's English–Simplified Chinese dictionary through a licensed API, requiring access arranged with the operator. **Oxford** documents English→Chinese translation support and paid-plan progression. These are viable commercial alternatives if richer learner articles become a requirement, but introducing credentials and negotiated usage is unnecessary for the recommended v1 route. Do not scrape their public websites as an API substitute. [Cambridge API](https://dictionary-api.cambridge.org/api/about), [storage licensing](https://dictionary-api.cambridge.org/api/faq), [Oxford language matrix](https://developer.oxforddictionaries.com/documentation/languages), [Oxford sandbox](https://developer.oxforddictionaries.com/documentation/getting_started/sandbox).

Word-frequency lists such as `wordfreq` solve frequency ranking, not lexical analysis or Chinese dictionary retrieval; ranking is unnecessary for the proposed contract and cannot establish dictionary identity. This is a requirements inference, not a measured provider evaluation.

## Implementation acceptance evidence to preserve

The implementation ticket should package the licensed hashed WordNet asset; validate its browser load; cover the 27 recorded lexical cases plus the supplement table; preserve case and Unicode apostrophes; show unavailable analysis/short meanings honestly; and keep selected-form dictionary lookup usable without fabricating a lemma. Reuse hosted API fixtures to verify English-only section isolation, Simplified Chinese rendering, ambiguity, page misses, technical failures, attribution and safe links. These are feature checks after implementation; the research probes alone do not certify a production adapter. [WordNet fixture evidence](english-wordnet-probes/provider-results.json), [dictionary fixture evidence](english-wiktionary-probes/provider-results.json), [safe article boundary](../adr/0008-dictionary-articles-as-text-and-links.md).

## Completed dictionary research gate

Fifteen bounded serial responses provide twelve English-section results, two API `missingtitle` outcomes, and one non-English page control. The sampled `he's` page is absent even though its contraction is ordinary English; `I`, `the`, `is` and `don't` have English articles. Multilingual pages require section isolation. A metadata-only resolution and revision-pinned retrieval succeeded, and an isolated Edge research worker returned Simplified Chinese text with only the Chinese Wiktionary research origin granted. The inert extractor passed source fixtures and controlled hostile markup. These observations support the bounded implementation contract, not corpus-wide coverage or production optional-permission acceptance. [Wire evidence](english-wiktionary-probes/provider-results.json), [resolution evidence](english-wiktionary-probes/resolution-results.json), [extraction](english-wiktionary-probes/extraction-results.json), [Edge](english-wiktionary-probes/edge-access-results.json), [fixture attribution and reproduction](english-wiktionary-probes/README.md).
