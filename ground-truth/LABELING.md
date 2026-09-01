# Ground-truth labelling convention

Read this before labelling a single document.

The eval harness compares model output to these labels character by character. If you
label `ACME Pty Ltd` on Monday and `Acme Pty. Ltd.` on Tuesday, the harness reports a
vendor error that is really a *you* error — and you will spend an afternoon tuning a
prompt against noise you created. **A mediocre convention applied consistently beats a
perfect convention applied loosely.** Decide once, write it here, follow it.

If you hit a case this document doesn't cover: add the rule here *first*, then label.

## Files

```
ground-truth/docs/acme-0042.pdf      # the source document (gitignored — may contain PII)
ground-truth/labels/acme-0042.json   # the label, joined by filename stem
```

The stem is the document id. Keep it lowercase, hyphenated, and stable — renaming a
document orphans its label.

## Label format

Labels hold **values only, no confidence**. Confidence is something the model asserts;
ground truth is what's true.

```json
{
  "invoiceNumber": "INV-0042",
  "invoiceDate": "2026-08-29",
  "vendor": "Acme Pty Ltd",
  "currency": "AUD",
  "lineItems": [
    { "description": "Widget", "quantity": 2, "unitPrice": 10.00, "amount": 20.00 }
  ],
  "total": 22.00,
  "notes": "Optional. Why this document is interesting, or what made a call ambiguous."
}
```

## Field rules

**invoiceNumber** — exactly as printed, including prefixes and leading zeros. `INV-0042`,
not `42`. Strip surrounding whitespace only. If the document shows both an "Invoice No."
and a separate "Reference", take the one labelled invoice.

**invoiceDate** — ISO 8601 `YYYY-MM-DD`, always. This is where ambiguity hides: `03/04/2026`
is 3 April in Australia and 4 March in the US. Resolve it from the vendor's country, and
if you cannot resolve it, **exclude the document from the set** rather than guess. One
wrong date label silently caps your date recall forever.
Use the *issue* date, never the due date or the paid date.

**vendor** — the legal entity being paid. Rules, in order:
1. Prefer the entity name near the ABN/tax number over the logo wordmark.
2. Keep the suffix as printed (`Pty Ltd`, `Ltd`, `Inc`, `GmbH`) but drop trailing periods:
   `Acme Pty Ltd`, not `Acme Pty. Ltd.`
3. Keep internal punctuation and `&`: `Smith & Sons`.
4. Title case as printed, except ALL-CAPS letterheads, which become Title Case.
   `ACME PTY LTD` → `Acme Pty Ltd`.

**currency** — ISO 4217, uppercase: `AUD`, `USD`, `EUR`. A bare `$` on an Australian
invoice is `AUD`. If the document shows no currency anywhere and the vendor's country is
unknown, use `null`.

**lineItems** — one entry per billable row **as printed**.
- Do NOT include subtotal, tax, shipping, or discount rows. Those are not line items;
  they are what the arithmetic check reconciles line items *against*.
- **Credits and discounts: position decides.** A discount or credit printed in the *totals
  block* is not a line item (`atlas-freight-77201`, volume discount). One printed *inside
  the item table*, with its own quantity and unit price, **is** a line item, and its
  `amount` keeps the minus sign (`veridian-2026-0311`, `-1250.00`).
  This is arbitrary in the sense that either rule would work — what is not arbitrary is
  picking one. Two labellers looking at a negative row will otherwise disagree, and the
  disagreement shows up as a model error. The rule follows the document's own structure,
  which is the tiebreak that needs the least judgement.
- `description` verbatim, whitespace collapsed to single spaces.
- `amount` as printed. If the printed amount disagrees with `quantity × unitPrice`,
  **record what is printed** and mention it in `notes`. That disagreement is a real
  document defect and one of the most valuable rows in the whole set.
- If the invoice has no itemisation at all, use `[]` — not `null`.

**total** — grand total payable including tax, as a number. No currency symbol, no
thousands separators. `1234.50`, not `"$1,234.50"`.

## Null vs absent

`null` means *the field is not on the document*. It is a correct answer, and the harness
scores it as one. Never use `null` to mean "I couldn't be bothered" or "it's blurry" —
that pollutes recall for every field it touches.

## Synthetic fixtures: `"synthetic": true`

Documents we generated ourselves (`../fixtures/*.html` → `../docs/*.pdf`) carry
`"synthetic": true` at the top of their label. Every other label omits the key.

This is not bookkeeping. Synthetic documents are **evidence about the plumbing, not about
accuracy**: we authored them, so the model does well on exactly the traps we thought to
include, and badly on nothing we failed to imagine. A number measured on documents you
wrote is measuring your imagination.

**The eval harness must filter these out of its accuracy run.** A flag in the label is the
only way it can — a folder convention gets forgotten the first time someone moves a file.
Use them for smoke tests, prompt iteration, and demoing the pipeline offline; never quote
a metric from them without saying it came from synthetic documents.

The named concept is **test-set contamination**: when the thing you measure on and the
thing you built from are not independent, the measurement stops meaning anything.

## Choosing the ~20 documents

Resist the urge to collect twenty clean PDFs. A set the model gets 100% on teaches you
nothing. Aim for roughly:

- 8 clean digital PDFs (the baseline — if these fail, something is badly wrong)
- 5 scans or phone photos (skew, shadow, low contrast — where confidence should drop)
- 3 multi-page or many-line invoices (tests whether line items get truncated)
- 2 with arithmetic that genuinely doesn't add up (the whole reason Week 2 exists)
- 2 awkward layouts: multi-column, handwritten annotations, or a foreign-language vendor

## The sample-size rule, stated up front

With ~20 documents, **one document is 5 percentage points**. A prompt change that moves
a field from 85% to 90% moved *one document*. That is indistinguishable from noise.

Before calling anything a win or a regression, ask: how many documents actually changed?
If the answer is one or two, the honest report is "no measurable change" — and the fix is
a bigger set, not a better story. Write the document count next to every number you quote.
