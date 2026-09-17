/**
 * Canonicalisation for COMPARISON ONLY.
 *
 * The rule this module exists to protect: raw stays raw. The model transcribes what is
 * printed, the ground-truth label records what is printed, and neither is ever rewritten.
 * Normalisation happens here, at the moment two values are compared, and nowhere else.
 *
 * Why that split matters. If you normalise inside the model or inside the label, the
 * printed form is gone forever and the decision is frozen — you can never ask "how would
 * the numbers look under a stricter rule?" because you no longer have the inputs. Doing
 * it here makes normalisation a *tunable knob* rather than a permanent, irreversible edit.
 * It also means these rules can be unit-tested on their own, with no API calls and no
 * corpus, which is why this file has tests and the prompt does not.
 *
 * Corollary for the eval harness (Week 3): report BOTH strict and canonical match rates.
 * The gap between them is informative — a large gap means your model is right about the
 * facts and wrong about the formatting, which is a completely different problem from
 * being wrong about the facts.
 */

/**
 * Unicode first, always.
 *
 * NFKC folds compatibility characters into their canonical forms, which matters more than
 * it sounds: PDFs are full of ligatures, non-breaking spaces, and full-width characters
 * that LOOK identical to their ASCII twins and compare unequal. A vendor mismatch you
 * cannot see in the terminal is nearly always this.
 */
function unicodeFold(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-") // en/em dashes, minus sign -> hyphen
    .replace(/[‘’‛]/g, "'") // curly single quotes -> apostrophe
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ") // collapses NBSP and tabs too, thanks to NFKC
    .trim();
}

/** Free text (line-item descriptions): fold, lowercase, strip trailing punctuation. */
export function canonicalText(value: string): string {
  return unicodeFold(value).toLowerCase().replace(/[.,;:]+$/, "");
}

/**
 * Vendor names.
 *
 * Note what this deliberately does NOT do: strip the entity suffix. Dropping "Pty Ltd"
 * would make "Acme Pty Ltd" and "Acme Holdings Ltd" collide, and merging two real
 * companies is a far worse error than failing to merge one. Casing, punctuation and
 * ampersand spelling are safe to fold; identity-bearing words are not.
 */
export function canonicalVendor(value: string): string {
  return unicodeFold(value)
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ISO 4217 codes are case-insensitive in the wild, canonical uppercase here. */
export function canonicalCurrency(value: string): string {
  return unicodeFold(value).toUpperCase();
}

/**
 * Money. Compared at 2dp because 379.5 and 379.50 are the same amount, and because
 * floating-point means `0.1 + 0.2 !== 0.3` — comparing raw floats for equality will
 * eventually report a mismatch that is arithmetic noise, not an extraction error.
 */
export function canonicalAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Dates are already ISO by convention, so this VALIDATES rather than parses. If a label
 * or an extraction is not ISO, that is a defect we want surfaced loudly, not silently
 * coerced — silent coercion is how a US-format date becomes a plausible wrong answer.
 */
export function canonicalDate(value: string): string {
  const folded = unicodeFold(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(folded)) {
    throw new Error(`Date is not ISO 8601 YYYY-MM-DD: ${JSON.stringify(value)}`);
  }
  return folded;
}

/**
 * Compare two field values under canonicalisation. `null` is a real answer: two nulls
 * match, and a null against a value does not.
 */
export function canonicalEquals(
  a: string | number | null,
  b: string | number | null,
  kind: "text" | "vendor" | "currency" | "amount" | "date",
): boolean {
  if (a === null || b === null) return a === b;
  if (kind === "amount") {
    return typeof a === "number" && typeof b === "number"
      ? canonicalAmount(a) === canonicalAmount(b)
      : false;
  }
  const [x, y] = [String(a), String(b)];
  switch (kind) {
    case "vendor":
      return canonicalVendor(x) === canonicalVendor(y);
    case "currency":
      return canonicalCurrency(x) === canonicalCurrency(y);
    case "date":
      return canonicalDate(x) === canonicalDate(y);
    case "text":
      return canonicalText(x) === canonicalText(y);
  }
}
