#!/usr/bin/env python3
"""Bounded, serial, accountless parser observations; never retry a failed request.

Default is offline fixture validation. --live explicitly makes at most 13 GETs
to the documented parser only. Stops on any HTTP/network/JSON failure. No
Heritage, Cologne, challenge solving, cookies, or input normalization.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
BASE = "https://sanskrit-parser.appspot.com/sanskrit_parser/v1/"
CASES = [
    ("version", "version/", None),
    ("wikipedia", "tags", "संस्कृतम्"),
    ("passage", "splits", "मामकाः पाण्डवाश्चैव"),
    ("constituent", "tags", "पाण्डवास्"),
    ("finite", "tags", "उवाच"),
    ("ambiguity", "tags", "सेनयोः"),
    ("suffix", "tags", "मा"),
    ("unknown", "splits", "झ्झ्झ्झ्झ"),
    ("punctuation", "splits", "धर्मक्षेत्रे कुरुक्षेत्रे ।"),
    ("punctuation_nonstrict", "splits", "धर्मक्षेत्रे कुरुक्षेत्रे ।"),
    ("nfc", "splits", "dharmakṣetre"),
    ("nfd", "splits", unicodedata.normalize("NFD", "dharmakṣetre")),
    ("unsupported", "tags", "hello🙂"),
]


def validate(rows):
    valid = []
    for row in rows:
        payload = row.get("json")
        if not payload or row.get("status") != 200:
            continue
        operation = row["operation"]
        if operation not in ("tags", "splits"):
            continue
        assert isinstance(payload.get("input"), str)
        assert isinstance(payload.get("devanagari"), str)
        assert payload["input"] == row["original"]
        values = payload[operation]
        assert isinstance(values, list)
        for value in values:
            assert isinstance(value, list)
            if operation == "tags":
                assert len(value) == 2 and isinstance(value[0], str)
                assert isinstance(value[1], list)
                assert all(isinstance(label, str) for label in value[1])
            else:
                assert value and all(isinstance(token, str) for token in value)
        valid.append({"case": row["case"], "count": len(values),
                      "possiblyCapped": operation == "splits" and len(values) >= 10})
    return valid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()
    target = ROOT / "provider-results.json"
    if args.live:
        if target.exists():
            parser.error("Refusing to overwrite recorded evidence; archive it before an authorized rerun")
        rows = []
        for name, operation, original in CASES:
            url = BASE + operation
            if original is not None:
                url += "/" + urllib.parse.quote(original, safe="")
            if name == "punctuation_nonstrict":
                url += "?strict=false"
            row = {"case": name, "operation": operation, "original": original,
                   "url": url, "startedAtUTC": datetime.datetime.now(datetime.timezone.utc).isoformat()}
            start = time.monotonic()
            try:
                with urllib.request.urlopen(url, timeout=20) as response:
                    body = response.read(1024 * 1024 + 1)
                    row.update(status=response.status, bytes=len(body),
                               headers=dict(response.headers), sha256=hashlib.sha256(body).hexdigest())
                    if len(body) > 1024 * 1024:
                        raise ValueError("Response exceeds 1 MiB research bound")
                    row["json"] = json.loads(body)
            except (OSError, ValueError) as error:
                row["error"] = str(error)
                if isinstance(error, urllib.error.HTTPError):
                    row["status"] = error.code
            row["seconds"] = round(time.monotonic() - start, 3)
            rows.append(row)
            target.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
            if "error" in row:
                break
            time.sleep(1)
    else:
        rows = json.loads(target.read_text())
    print(json.dumps(validate(rows), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
