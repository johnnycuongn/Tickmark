# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: Week 1 scaffolded (2026-08-29)

**Exists:** `package.json`, `tsconfig.json`, `.nvmrc` (22.12.0), the extraction schema, the model adapter seam,
a Gemini adapter, a CLI, 7 passing schema tests, and `ground-truth/LABELING.md`.
**Does not exist yet:** any labelled documents, scoring, Postgres, review UI, eval harness. Sections below marked
"planned" are still design intent. Replace them with what's real as you build.

**Next action:** collect and label 15–20 documents per `ground-truth/LABELING.md`. Nothing downstream can be
measured until that set exists, so it is the bottleneck, not the code.

Toolchain note: Node is installed and on PATH as of 2026-08-29 — **node v20.19.6, npm 10.8.2**, owned by nvm
(`~/.nvm`, default alias `20.19.6`). Also installed: 20.11.0, 22.12.0, 24.15.0. Docker is at `/usr/local/bin/docker`.

Never install Node via Homebrew here — `dev-mac-set-up-main/Brewfile:38` deliberately excludes it, because multiple
node binaries on PATH is what broke this machine before. `type -a node` must print exactly one path, under `~/.nvm`.

This project pins **22.12.0** via `.nvmrc`; run `nvm use` on entering the directory. The nvm *default* is 20.19.6,
pinned for unrelated Angular/Karma constraints, so a shell that hasn't run `nvm use` is on the wrong version.
Note nvm scopes global npm packages per version.

## What this project is

An invoice/document extractor with per-field confidence scoring and a human review queue. It is a **learning
project** — the goal is demonstrable eval literacy, not a product. It deliberately extends the user's prior
invoice-matching/reconciliation work at iMSX into an AI-assisted version, and is meant to read as resume-ready.

## The learning contract

This is a **learning project**. Shipped code is the by-product; understanding is the deliverable. Optimise every
response for what Johnny will still know in three months, not for how fast the task closes.

**Register.** Answer as a mentor. For every non-obvious choice: what we did, *why* that over the alternative, what
it costs, and the name of the concept so it's searchable later. A named concept ("this is the adapter pattern",
"this is precision vs recall") is worth more than three paragraphs of explanation, because it's a handle for
further reading.

**Rules for working here:**

1. **Never hand back a wall of finished code.** Build in steps, and say what each step is for before writing it.
2. **Name the tradeoff, don't hide it.** Every design choice here has a real alternative. Say what it was and why
   it lost. If a choice is arbitrary, say *that* — false rationalisation is worse than admitted taste.
3. **Comment the why, not the what.** The comments in `src/` explain reasoning and failure modes. That density is
   deliberate and specific to this repo — it is teaching material, not production style. Match it.
4. **Prefer the boring diagnosis.** When something breaks, walk the reasoning (what did we expect, what happened,
   what does the gap imply) rather than jumping to a patch. Debugging is the transferable skill.
5. **Let mistakes stand long enough to be instructive.** If a design decision is about to cause a problem two weeks
   out, say so and let it happen when the cost is low — a lived failure teaches more than a warning.
6. **Push back on numbers.** If Johnny quotes an accuracy figure, ask how many documents moved. See the sample-size
   rule in `ground-truth/LABELING.md`.

**Concepts this project is designed to teach**, stage by stage — these are the things worth being able to explain
in an interview:

| Stage | Concept to walk away with |
|---|---|
| Extract | Schema-forced structured output vs. parsing prose; why multimodal beats pre-OCR; the adapter pattern as a swap seam |
| Score | Self-reported vs. computed confidence; why a weak signal and a strong one are kept separate rather than averaged |
| Persist | Raw vs. corrected as separate columns; why a destructive update is a deleted dataset |
| Review UI | Controlled form state; optimistic updates and what to do when the server disagrees |
| Eval | Precision vs. recall per field, and why a single accuracy number hides the interesting failures; labelling consistency; sample size and noise |

## Code map

```
src/schema.ts            Zod schema — single source of truth. Feeds TS types, the model's
                         forced output schema, and runtime validation. Start reading here.
src/model/adapter.ts     The seam: Document in, ExtractionResult out. No provider vocabulary.
src/model/gemini.ts      Gemini 2.5 Flash implementation + the prompt.
src/model/index.ts       createAdapter() — the one place that picks a provider.
src/document.ts          File -> Document. Filename stem is the id that joins to labels.
src/cli.ts               npm run extract -- <file>
src/__tests__/           Schema tests. No network — they run in ~200ms.
ground-truth/LABELING.md The labelling convention. Read before labelling anything.
```

## Architecture (planned)

The pipeline is four stages, and the seams between them are the point of the project:

```
PDF/image ──▶ extract ──▶ score ──▶ persist ──▶ review UI
             (LLM)     (confidence) (Postgres)   (React)
                                        ▲            │
                                        └── correction diff
                                                     │
                                    eval harness ◀───┘ (ground truth)
```

1. **Extract** — Node/TS API. Send the PDF/image to the model *multimodally*; do not pre-OCR. Structured output is
   forced by schema (Gemini `responseSchema`, or Claude tool use), never parsed out of prose. Target fields:
   invoice number, date, vendor, line items, total.
2. **Score** — two independent confidence signals per field, kept separate:
   - model self-reported certainty (weak signal),
   - **arithmetic cross-checks** (do line items sum to the total?) — this is the trustworthy one. Prefer it when the
     two disagree, and keep both stored so the eval harness can show *why* it's the better signal.
   Fields below threshold route to the review queue.
3. **Persist** — Postgres/Supabase. **Raw model extraction and human corrections live in separate columns/tables.**
   This is load-bearing: the diff between them is the training signal for the evals, and overwriting the raw value
   destroys it permanently. Never "fix up" a raw extraction in place.
4. **Review UI** — React approve/edit flow over low-confidence fields. Controlled form state, optimistic updates.

### Eval harness

Runs the pipeline over a hand-labeled ground-truth set of 15–20 documents and reports **field-level precision and
recall**, not a single overall accuracy number. Consider Promptfoo or Braintrust rather than rolling it by hand.

Two rules that matter more than the code:
- Label the ground-truth set **consistently** (one documented convention for dates, currency, vendor name
  normalization) — inconsistent labels make every later metric meaningless.
- With ~20 documents, a few points of movement is **noise**. Before calling a prompt change a regression or a win,
  check whether the delta is larger than the test set can resolve.

### Optional polish

pgvector cosine-similarity search for "find similar past invoices" (a light RAG layer); deploy on Vercel or Railway
free tier; a metrics-first README that leads with the accuracy numbers.

## Model choice

Start on the **Gemini API free tier (2.5 Flash)** — ~1,500 requests/day, native PDF/image input, no card required,
which suits scanned documents and keeps the eval loop cheap to re-run. Keep the model call behind a thin adapter so
swapping to Claude tool use later is a one-file change.

## Roadmap

- **Week 1** — structured extraction + the ground-truth set.
- **Week 2** — confidence signals, Postgres schema, review UI.
- **Week 3** — eval harness, per-field precision/recall, reading regressions.
- **Week 4** — buffer: pgvector, deploy, README.

## Commands

Run `nvm use` first in any new shell — otherwise you are on 20.19.6 and `engines` will complain.

```bash
npm install
npm run extract -- ground-truth/docs/acme-0042.pdf   # one document -> JSON on stdout, stats on stderr
npm run typecheck                                    # tsc --noEmit
npm test                                             # vitest run (all)
npx vitest run src/__tests__/schema.test.ts          # a single test FILE
npx vitest run -t "rejects confidence outside 0-1"   # a single test CASE by name
npm run test:watch                                   # watch mode
```

Requires `.env` with `GEMINI_API_KEY` (copy `.env.example`; key from https://aistudio.google.com/apikey).

Eval harness: not built yet (Week 3). Record its invocation here when it exists.
