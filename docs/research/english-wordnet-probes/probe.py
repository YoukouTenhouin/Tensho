"""Bounded WordNet morphology research, not a production analyzer.

Run: python3 docs/research/english-wordnet-probes/probe.py /tmp/WordNet-3.0.tar.gz
Downloads must be acquired separately from the URL in the report.
"""
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile

ARCHIVE_SHA256 = "640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52"
RULES = {
    "noun": [("s", ""), ("ses", "s"), ("xes", "x"), ("zes", "z"), ("ches", "ch"), ("shes", "sh"), ("men", "man"), ("ies", "y")],
    "verb": [("s", ""), ("ies", "y"), ("es", "e"), ("es", ""), ("ed", "e"), ("ed", ""), ("ing", "e"), ("ing", "")],
    "adj": [("er", ""), ("est", ""), ("er", "e"), ("est", "e")],
    "adv": [],
}
FIXTURES = ["saw", "went", "children", "mice", "better", "best", "leaves", "axes", "running", "reading", "read", "am", "is", "are", "was", "were", "had", "don't", "he's", "the", "I", "a", "color", "colour", "look up", "state-of-the-art", "foobarxyz"]

def main():
    archive = Path(sys.argv[1]).read_bytes()
    assert hashlib.sha256(archive).hexdigest() == ARCHIVE_SHA256
    files = {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for name in ["LICENSE"] + [f"dict/{pos}.{kind}" for pos in RULES for kind in ["exc"]] + [f"dict/index.{pos}" for pos in RULES]:
            member = tar.getmember(f"WordNet-3.0/{name}")
            assert member.size < 5_000_000
            files[name] = tar.extractfile(member).read()
    index = {pos: {line.split()[0] for line in files[f"dict/index.{pos}"].decode().splitlines() if line and not line.startswith(" ")} for pos in RULES}
    exceptions = {pos: {line.split()[0]: line.split()[1:] for line in files[f"dict/{pos}.exc"].decode().splitlines()} for pos in RULES}
    asset = json.dumps({"index": {pos: sorted(values) for pos, values in index.items()}, "exceptions": exceptions}, separators=(",", ":")).encode()
    results = {}
    for word in FIXTURES:
        normalized = word.lower().replace(" ", "_")
        candidates = []
        for pos, rules in RULES.items():
            proposals = ([normalized] if normalized in index[pos] else []) + exceptions[pos].get(normalized, []) + [normalized[:-len(suffix)] + ending for suffix, ending in rules if normalized.endswith(suffix)]
            for lemma in dict.fromkeys(proposals):
                if lemma in index[pos]:
                    evidence = "exact" if lemma == normalized else "exception" if lemma in exceptions[pos].get(normalized, []) else "suffix"
                    candidates.append({"lemma": lemma, "partOfSpeech": pos, "evidence": evidence})
        results[word] = candidates
    output = {
        "researchDate": "2026-10-07", "source": "https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz",
        "archive": {"bytes": len(archive), "sha256": ARCHIVE_SHA256},
        "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in files.items()},
        "asset": {"jsonBytes": len(asset), "gzipBytes": len(gzip.compress(asset, mtime=0)), "indexCounts": {pos: len(values) for pos, values in index.items()}},
        "results": results,
        "limits": "Lowercasing and suffix detachment intentionally expose ambiguity and false positives; this is a bounded lexical proposal experiment, not contextual analysis. No full dictionary definitions are packaged."
    }
    Path(__file__).with_name("provider-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"fixtures": len(results), "asset": output["asset"]}))

if __name__ == "__main__":
    main()
