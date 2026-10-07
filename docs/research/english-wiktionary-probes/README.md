# Chinese Wiktionary research evidence

The provider text in `provider-results.json`, `resolution-results.json` and its extracted form in `extraction-results.json` is attributed to Chinese Wiktionary contributors and available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), as identified by the [source article footer](https://zh.wiktionary.org/zh-hans/saw). Additional terms may apply to separately credited material. The software probes are repository-authored; this notice concerns the retained source text.

Changes: responses are retained as parsed JSON, and the extraction output removes markup, non-English top-level sections, active/media elements and site furniture. Simplified/Traditional Chinese conversion is performed by the provider. No audio or image binary is retained. Source history and contributor attribution are available through each revision page and its History link.

## Source revisions

- [book, revision 9744765](https://zh.wiktionary.org/w/index.php?oldid=9744765) — Chinese Wiktionary contributors.
- [saw, revision 9733928](https://zh.wiktionary.org/w/index.php?oldid=9733928) — Chinese Wiktionary contributors.
- [good, revision 8433586](https://zh.wiktionary.org/w/index.php?oldid=8433586) — Chinese Wiktionary contributors.
- [go, revision 8459041](https://zh.wiktionary.org/w/index.php?oldid=8459041) — Chinese Wiktionary contributors.
- [gift, revision 9587708](https://zh.wiktionary.org/w/index.php?oldid=9587708) — Chinese Wiktionary contributors.
- [don't, revision 8459285](https://zh.wiktionary.org/w/index.php?oldid=8459285) — Chinese Wiktionary contributors.
- [ice-cream, revision 5995707](https://zh.wiktionary.org/w/index.php?oldid=5995707) — Chinese Wiktionary contributors.
- [I, revision 8459882](https://zh.wiktionary.org/w/index.php?oldid=8459882) — Chinese Wiktionary contributors.
- [the, revision 9718480](https://zh.wiktionary.org/w/index.php?oldid=9718480) — Chinese Wiktionary contributors.
- [is, revision 8433723](https://zh.wiktionary.org/w/index.php?oldid=8433723) — Chinese Wiktionary contributors.
- [Wasser, revision 9550639](https://zh.wiktionary.org/w/index.php?oldid=9550639) — Chinese Wiktionary contributors.
- [水, revision 9895978](https://zh.wiktionary.org/w/index.php?oldid=9895978) — Chinese Wiktionary contributors.

## Reproduction

Run `python3 docs/research/english-wiktionary-probes/probe.py` for serial requests with a 15-second timeout and 1 MiB response limit; it preserves existing cases and fetches only missing ones. Remove or move the results file to repeat the complete live batch. It stops on transport or unexpected API failure. `node docs/research/english-wiktionary-probes/extract.mjs` validates retained fixtures offline.

Run `python3 docs/research/english-wiktionary-probes/resolve.py` for the two-call metadata→pinned article proof. Run `python3 docs/research/english-wiktionary-probes/edge_access.py` for one live call from a disposable headless Edge extension. The latter pregrants the research origin and does not establish production optional-prompt behavior.

The initial metadata→article fixture was observed during the 2026-10-07 research run; its older output lacks per-request timestamps. The reproducible script now records them. Raw-body SHA-256 values describe downloaded bytes, while saved JSON is a parsed representation.
