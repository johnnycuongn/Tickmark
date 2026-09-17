import { FIELD_NAMES, type FieldName, type RawExtraction } from "./schema.js";

/**
 * Computed confidence — signal #2 of two.
 *
 * Signal #1 is the model's self-reported `confidence` on each field (see schema.ts). It is
 * a weak signal: on the 2026-09-17 run it came back 1.0 on every clean document and was
 * inconsistent across identical situations. Signal #2 is this file: arithmetic the model
 * cannot flatter. If the line items do not sum to the total, something is wrong, whatever
 * the model claims.
 *
 * The two are stored side by side and NEVER averaged. Averaging a strong signal with a weak
 * one produces a medium signal, which is strictly worse than having the strong one alone.
 * Keeping them separate also lets the eval harness show *why* the computed one is better —
 * that comparison is the point of Stage 2. Concept to search for: "cross-check validation",
 * "independent evidence".
 */

/**
 * One cent. This absorbs rounding (each line rounded to cents, then summed, can drift by a
 * cent from the printed total) and nothing else.
 *
 * The tempting mistake is to widen it until taxed invoices pass. Do not. On an invoice with
 * 10% GST the line items sum to the *subtotal*, so this check will fail — correctly. That
 * failure is the evidence that the schema needs a `subtotal`/`tax` field. A tolerance wide
 * enough to hide tax is wide enough to hide a misread digit, and the check stops being a
 * signal. A test pins this value for that reason.
 */
export const TOLERANCE = 0.01;

/**
 * The result has three states, not two, and the type must keep them apart:
 *   - `{ ok: true }`   checked, consistent
 *   - `{ ok: false }`  checked, inconsistent — evidence of an extraction error
 *   - `null`           could not check — absence of evidence, not evidence of absence
 *
 * Collapsing `null` into `false` would route every un-itemised invoice to review for a
 * "failure" that never happened, and the harness could no longer tell "we found a problem"
 * from "we had nothing to look at".
 *
 * `delta` is signed (total − sum) because the sign is diagnostic: positive means the total
 * is bigger than the lines (missing tax, missed line item); negative means the lines are
 * bigger than the total (misread digit, duplicated line). Different failure, different fix.
 */
export interface TotalCheck {
  ok: boolean;
  delta: number;
}

export function scoreTotal(amounts: number[], total: number | null): TotalCheck | null {
  if (total === null || amounts.length === 0) return null;

  // Sum in integer cents, not floats. 0.1 + 0.2 !== 0.3 in IEEE 754, and ten lines of 0.10
  // drift to 0.9999999999999999. Money is an integer count of the smallest unit; treating it
  // as a float is the classic bug. Round each line first, because that is what the invoice
  // printer did before it summed them.
  const sumCents = amounts.reduce((acc, a) => acc + Math.round(a * 100), 0);
  const totalCents = Math.round(total * 100);
  const deltaCents = totalCents - sumCents;

  return { ok: Math.abs(deltaCents) <= TOLERANCE * 100, delta: deltaCents / 100 };
}


/**
 * Below this self-reported confidence a field goes to review. 0.7 is a guess, and an
 * admitted one: with the self-report saturating at 1.0 on clean docs and 0.4/0.9 on the
 * two flagged cases so far, any value between 0.5 and 0.9 gives the same routing on the
 * current 6 documents. The eval harness is what turns this guess into a tuned number —
 * plot review-queue size against caught errors and pick the knee. Until then, do not
 * agonise over it.
 */
export const REVIEW_THRESHOLD = 0.7;

/**
 * Both signals, side by side, plus the routing decision. The signals stay separate in the
 * stored record (and later in the Postgres row) so the harness can answer "how often did
 * the self-report say 1.0 while the arithmetic said no?" — the question that justifies
 * building signal #2 at all.
 */
export interface ScoredExtraction {
  /** Signal #1: what the model claimed, per field. Weak. */
  selfReported: Record<FieldName, number>;
  /** Signal #2: what the arithmetic says. Strong. Keyed by the field it vouches for. */
  computed: { total: TotalCheck | null };
  /** Fields a human must look at, in FIELD_NAMES order for stable diffs. */
  needsReview: FieldName[];
}

export function scoreExtraction(
  extraction: RawExtraction,
  threshold: number = REVIEW_THRESHOLD,
): ScoredExtraction {
  const selfReported = Object.fromEntries(
    FIELD_NAMES.map((f) => [f, extraction[f].confidence]),
  ) as Record<FieldName, number>;

  const totalCheck = scoreTotal(
    extraction.lineItems.value.map((li) => li.amount),
    extraction.total.value,
  );

  const flagged = new Set<FieldName>();
  for (const f of FIELD_NAMES) if (selfReported[f] < threshold) flagged.add(f);

  // A failed sum implicates two fields, and we cannot tell which one is wrong: a misread
  // total and a missed line item look identical from here. Route both; the reviewer has
  // the document, we do not. Routing only `total` would be guessing.
  //
  // A null check adds nothing. Absence of evidence does not route anything to review —
  // the whole reason scoreTotal returns three states instead of a boolean.
  if (totalCheck?.ok === false) {
    flagged.add("lineItems");
    flagged.add("total");
  }

  return {
    selfReported,
    computed: { total: totalCheck },
    needsReview: FIELD_NAMES.filter((f) => flagged.has(f)),
  };
}
