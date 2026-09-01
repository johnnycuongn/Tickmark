#!/usr/bin/env python3
"""Assert every label still describes the fixture it is named after.

WHY THIS EXISTS: LABELING.md says label consistency matters more than any code in this
project, and it is right — an inconsistent label reports a model error that is really a
you error, and you cannot tell the difference from the metrics. The specific way this set
will rot is drift: someone edits a fixture's HTML, forgets the label, and from then on the
eval quietly reports a permanent failure on a document that is actually fine.

This checks the cheap, mechanical half of consistency — do the values in the label
actually appear on the page. It cannot check the judgement half (is this row really a
line item?); that lives in the conventions in LABELING.md and in each label's `notes`.

Run: npm run fixtures:check
"""
import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def text_of(path: pathlib.Path) -> str:
    """Roughly what a reader sees: strip our teaching comments, CSS and tags."""
    s = re.sub(r"<!--.*?-->", " ", path.read_text(), flags=re.S)
    s = re.sub(r"<style.*?</style>", " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s))


def printed_forms(value: float) -> set[str]:
    """Every formatting an amount might legitimately carry on a document.

    1234.5 -> {"1234.50", "1,234.50", "1.234,50"}. The last one is not decoration: the
    German fixture groups with "." and uses "," as the decimal point, and a checker that
    doesn't know that reports a false failure on a correct label.
    """
    plain = f"{abs(value):.2f}"
    grouped = f"{abs(value):,.2f}"
    european = grouped.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return {plain, grouped, european}


def check(stem: str) -> list[str]:
    label = json.loads((ROOT / "labels" / f"{stem}.json").read_text())
    fixture = ROOT / "fixtures" / f"{stem}.html"
    if not fixture.exists():
        return ["no fixture HTML — is this a real document rather than a synthetic one?"]

    text = text_of(fixture)
    # Sign stripped: a printed "-1,250.00" still contains the figure 1,250.00, and the
    # label carries the sign separately.
    printed = {tok.lstrip("-−") for tok in re.findall(r"[-−]?[\d.,]+", text)}
    problems: list[str] = []

    number = label["invoiceNumber"]
    if number is None:
        # A null claim is an assertion about the document, so verify it rather than skip it.
        if re.search(r"(invoice|docket|document)\s*(no\.?|number|#)", text, re.I):
            problems.append("label says invoiceNumber is null, but the page prints one")
    elif number not in text:
        problems.append(f"invoiceNumber {number!r} does not appear on the page")

    if label["total"] is not None and not printed_forms(label["total"]) & printed:
        problems.append(f"total {label['total']} is not printed in any recognised format")

    for item in label["lineItems"]:
        if item["description"] not in text:
            problems.append(f"line description not on the page: {item['description']!r}")
        if not printed_forms(item["amount"]) & printed:
            problems.append(f"line amount {item['amount']} is not on the page")

    return problems


def main() -> int:
    failures = 0
    for label_path in sorted((ROOT / "labels").glob("*.json")):
        problems = check(label_path.stem)
        items = len(json.loads(label_path.read_text())["lineItems"])
        print(f"{'FAIL' if problems else 'ok':4}  {label_path.stem:30} items={items:2}")
        for problem in problems:
            print(f"        - {problem}")
        failures += bool(problems)

    print("\nAll labels match their fixture." if not failures else f"\n{failures} label(s) drifted.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
