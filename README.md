# Tickmark

**Invoice extraction that tells you which fields to check.**

Pulling fields out of an invoice with an LLM is a weekend project. Knowing which of those
fields you can post to a ledger *without a human looking at them* is the actual problem.
Tickmark is the second thing.

> **Status — week 1 of 4.** Structured extraction and the ground-truth harness are real and
> tested. Confidence scoring, persistence, the review UI and the eval harness are not built
> yet. There are no accuracy numbers in this README, and [the reason](#results) is the point.

---

## The problem this solves

An extraction model is never 100% right, and the dangerous failure isn't a blank field — it's
a **confidently wrong** one. A missing total gets caught. A total that's wrong by one digit
gets paid.

Without a trustworthy confidence signal you get two bad options:

| | Outcome |
|---|---|
| Trust every extraction | Wrong values flow into the ledger silently |
| Check every extraction | You automated nothing — a human still reads all 400 invoices |

Tickmark exists for the third option: **auto-accept the fields that are safe, route the rest
to a human.** The value of the system is that ratio — not its accuracy.

The concept is **selective prediction** (a model with a *reject option*). Once a model is
allowed to abstain, you stop measuring it on one axis and start measuring two: how much it
handled alone (**coverage**), and how right it was on what it kept. That pair is what the
eval harness reports.

## Two confidence signals, deliberately not averaged

Every extracted field carries **two independent** signals, stored separately:

1. **Model self-report** — the certainty the model attaches to its own answer. This is the
   *weak* signal. It is the model grading its own homework, and LLMs are cheerfully confident
   when wrong.
2. **Arithmetic cross-checks** — do the line items sum to the subtotal? subtotal + tax = total?
   This is the *strong* signal, because it's derived from the document rather than from an
   opinion.

They are never blended into one score, because averaging destroys the only interesting case:
**the invoice where the model said 0.95 and the arithmetic is off by $40.** That disagreement
is the evidence that self-reported confidence can't be trusted — and you can only show it if
you kept both numbers. When they conflict, the arithmetic wins.

## Pipeline

```
PDF/image ──▶ extract ──▶ score ──▶ persist ──▶ review UI
             (LLM)     (confidence) (Postgres)   (React)
                                        ▲            │
                                        └── correction diff
                                                     │
                                    eval harness ◀───┘ (ground truth)
```

| Stage | State | What it does |
|---|---|---|
| **Extract** | ✅ built | Multimodal PDF/image → JSON, forced by schema. No pre-OCR, no prose parsing. |
| **Score** | ⬜ week 2 | Self-report + arithmetic cross-checks; below-threshold fields route to review. |
| **Persist** | ⬜ week 2 | Postgres. Raw extraction and human corrections in **separate columns**. |
| **Review UI** | ⬜ week 2 | React approve/edit over low-confidence fields only. |
| **Eval** | ⬜ week 3 | Per-field precision and recall against the labelled set. |

The correction diff is why raw and corrected never share a column. Every human edit is a
labelled example — *model said X, truth was Y*. Overwrite the raw value and you haven't fixed
a record, you've deleted a dataset, permanently.

---

## Results

**None yet — and publishing one now would be the exact mistake this project exists to avoid.**

The nine documents currently in the repo are **synthetic**: I wrote them. Scoring a model on
documents I authored measures my imagination, not the model's accuracy — it does well on
exactly the traps I thought to include and badly on nothing I failed to imagine. The named
failure is **test-set contamination**. Every synthetic label carries `"synthetic": true`
precisely so the eval harness can exclude them, and so no number can leak out by accident.

When the real set (15–20 hand-labelled documents) lands, this table fills in — **per field,
precision and recall separately**, because a single accuracy number hides every interesting
failure. A model that never emits a date has perfect date precision.

| Field | Precision | Recall | n |
|---|---|---|---|
| `invoiceNumber` | — | — | — |
| `invoiceDate` | — | — | — |
| `vendor` | — | — | — |
| `currency` | — | — | — |
| `lineItems` | — | — | — |
| `total` | — | — | — |

Two rules this README will honour when those cells have numbers in them:

- **Every figure is quoted with its document count.** With ~20 documents, **one document is
  5 percentage points**. A field moving 85% → 90% moved *one invoice*.
- **A delta smaller than the set can resolve is reported as "no measurable change"** — not as
  a win. The fix for an unresolvable delta is a bigger set, not a better story.

---

## The ground-truth set is the project

The extractor took an afternoon. The labelling convention took longer, and it's the part
worth reading: [`ground-truth/LABELING.md`](ground-truth/LABELING.md).

Inconsistent labels make every downstream metric meaningless. Label `ACME Pty Ltd` on Monday
and `Acme Pty. Ltd.` on Tuesday and the harness reports a vendor error that is really a *you*
error — then you spend an afternoon tuning a prompt against noise you created. So the
convention is written down first and followed exactly, including the arbitrary calls (it says
which ones are arbitrary).

A corpus where everything passes teaches nothing, so each synthetic fixture breaks one
specific thing:

| Fixture | What it breaks |
|---|---|
| `acme-0042` | Reference vs invoice number; due vs issue date; subtotal rows that aren't line items |
| `globex-2291` | `03/04/2026` from a US vendor is **4 March** |
| `atlas-freight-77201` | `09/07/2026` from a UK vendor is **9 July** — same shape, opposite reading. Plus a discount that makes `sum(lineItems) != total` |
| `nordwind-r-2026-118` | German invoice: `2.480,00` is 2480.00, not 2.48 |
| `pinnacle-8817` | A printed amount that contradicts `qty × unitPrice` — and propagates into the subtotal |
| `harbour-legal-0007` | No itemisation at all → `[]`, and the temptation to invent a line item |
| `citywide-44120` | 22 line items across two pages → silent truncation |
| `rosetta-produce-2026-08-21` | **No invoice number printed** → `null`. Handwritten annotation, no GST line |
| `veridian-2026-0311` | `11,520.00` thousands separators; a negative credit *inside* the item table |

The two date fixtures are a matched pair on purpose. If a prompt change fixes `globex-2291`
and breaks `atlas-freight-77201`, it learned a *format* rather than a *rule* — and only having
both documents lets you see that.

Fixtures are committed as HTML and rendered to PDF on demand. The PDFs are build output and
are **not** committed, so a document and its label can't silently drift apart without
`npm run fixtures:check` noticing.

---

## Design decisions worth a look

**One schema, three consumers** — [`src/schema.ts`](src/schema.ts) is the single source of
truth. The same Zod object produces the TypeScript types, the JSON Schema handed to the model
as `responseJsonSchema`, and the runtime `.parse()`. A schema-constrained model is *usually*
obedient, not *always*, so the runtime validation stays. Let those three drift and you get the
classic failure: types say one thing, the model emits another, nothing complains until the
eval numbers look insane.

**Nulls are a real answer** — every field is `.nullable()`. "Not present on the document" and
"guessed wrong" are different errors with different fixes, and a model given no way to say
*absent* will hallucinate a value. The harness scores a correct `null` as correct.

**The adapter is a seam, not a rename** — [`src/model/adapter.ts`](src/model/adapter.ts)
defines `Document in, ExtractionResult out` and mentions no provider vocabulary: no prompts,
no parts, no safety settings. Swapping Gemini for Claude tool use touches one implementation
file and the factory, nothing else. *An abstraction that leaks its first implementation's
vocabulary isn't an abstraction.*

**The raw response text is kept** — when a field regresses, the first question is always "did
the model say something different, or did our parsing change?" You cannot answer that without
the model's literal output. Same instinct as the raw-vs-corrected column split: keep the
upstream artifact, derived values can be recomputed.

---

## Quickstart

Requires Node 22.12.0 (`.nvmrc`) and a `GEMINI_API_KEY` — free tier, no card
([get one](https://aistudio.google.com/apikey)).

```bash
nvm use
npm install
cp .env.example .env          # add your GEMINI_API_KEY

npm run fixtures              # render the synthetic invoices -> ground-truth/docs/*.pdf
npm run fixtures:check        # assert every label still matches its fixture
npm run extract -- ground-truth/docs/pinnacle-8817.pdf
```

`extract` prints JSON on stdout and timing/token stats on stderr, so it pipes cleanly:

```bash
# every field is a {value, confidence} envelope, so confidence travels with the value
npm run extract -- ground-truth/docs/acme-0042.pdf | jq '.total'
# { "value": 379.5, "confidence": 0.98 }
```

```bash
npm run typecheck                              # tsc --noEmit
npm test                                       # vitest run — no network, ~200ms
npx vitest run -t "rejects confidence outside 0-1"
```

## Roadmap

- [x] **Week 1** — schema-forced extraction, adapter seam, labelling convention, fixture corpus
- [ ] **Week 2** — arithmetic cross-checks, Postgres (raw ≠ corrected), React review queue
- [ ] **Week 3** — eval harness, per-field precision/recall, reading a regression honestly
- [ ] **Week 4** — pgvector "find similar invoices", deploy, metrics-first rewrite of this file

## What this is not

Not a product and not for production use. It's a deliberate study in **eval literacy** —
building the measurement apparatus *before* the feature, and being willing to publish where a
system is weak. It extends prior invoice-matching and reconciliation work into an AI-assisted
version, which is why the accounting conventions are opinionated rather than invented.

Built with Gemini 2.5 Flash behind an adapter, TypeScript, Zod and Vitest.
