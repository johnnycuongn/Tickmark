# Synthetic fixtures

HTML sources for invoices we generated ourselves, plus the scripts that build and check
them. Committed — unlike `../docs/`, which is gitignored because real invoices carry
third-party PII.

```bash
npm run fixtures         # render every *.html here -> ../docs/<stem>.pdf
npm run fixtures:check   # assert every label still matches its fixture
npm run extract -- ground-truth/docs/pinnacle-8817.pdf
```

The PDFs are **build output** and are not committed. They are derived from the HTML in this
directory, so committing them would mean committing a binary that can silently disagree with
its source. The cost is one command after a fresh clone; the benefit is that the document
and its label can never drift apart without `fixtures:check` noticing.

## What each one is for

A corpus where everything passes teaches nothing, so each fixture breaks one specific thing.
The trap is documented twice: in an HTML comment at the top of the source, and in the
`notes` field of `../labels/<stem>.json`.

| Fixture | What it tests |
|---|---|
| `acme-0042` | Baseline. Reference vs invoice number, due vs issue date, subtotal rows that aren't line items |
| `globex-2291` | `03/04/2026` from a US vendor is **4 March** |
| `atlas-freight-77201` | `09/07/2026` from a UK vendor is **9 July** — same shape, opposite reading. Also two-column layout, and a discount that makes `sum(lineItems) != total` |
| `nordwind-r-2026-118` | German invoice; `2.480,00` is 2480.00, not 2.48 |
| `pinnacle-8817` | A printed amount that contradicts qty × unit price, and propagates into the subtotal |
| `harbour-legal-0007` | No itemisation at all → `[]`, and the temptation to invent a line item |
| `citywide-44120` | 22 line items over two pages → truncation |
| `rosetta-produce-2026-08-21` | **No invoice number printed** → `null`. Plus a handwritten annotation and no GST line |
| `veridian-2026-0311` | `11,520.00` thousands separators, and a negative credit inside the item table |

The date fixtures are deliberately a matched pair. If a prompt change fixes `globex-2291`
and breaks `atlas-freight-77201`, it learned a format rather than a rule — and only having
both documents lets you see that.

## These are not the eval set

Every label here carries `"synthetic": true`, and the eval harness must filter on it. We
authored these documents, so the model does well on exactly the traps we thought to include
and badly on nothing we failed to imagine — a metric measured on them is measuring our
imagination. Use them to smoke-test the plumbing, iterate on prompts offline, and demo the
pipeline without burning API quota on real documents. See `../LABELING.md`.

## Adding one

1. Write `<stem>.html` here, with a comment at the top saying what it breaks and why.
2. Write `../labels/<stem>.json` — same stem, that join is how everything pairs up.
   Include `"synthetic": true` and put the trap in `notes`.
3. `npm run fixtures && npm run fixtures:check`.
4. Look at the PDF. Two of these fixtures rendered wrong the first time — one buried the
   total under the handwritten annotation, one collapsed three numeric columns into
   `678.00468.00`. Both were unreadable to a *human*, which makes them noise rather than a
   test. Awkward is the goal; illegible is a bug.

`build.sh` drives headless Chrome, which is already on this machine and needs no dependency
in `package.json`. It kills the browser once the PDF stops growing, because Chrome 152
writes the file in about a second and then never exits. If this ever needs to run in CI,
replace that one file with Playwright and nothing else in the project changes.
