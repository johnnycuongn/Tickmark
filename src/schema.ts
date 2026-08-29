import { z } from "zod";

/**
 * The single source of truth for what an invoice extraction looks like.
 *
 * This one file feeds three consumers, which is the whole point of defining it once:
 *   1. TypeScript types      — via z.infer, so the compiler knows the shape
 *   2. the model's output    — via toJsonSchema(), handed to Gemini as responseJsonSchema
 *   3. runtime validation    — via .parse(), because a schema-constrained model is
 *                              *usually* obedient, not *always* obedient
 *
 * If these three ever drift apart you get the classic failure: types say one thing,
 * the model emits another, and nothing complains until the eval numbers look insane.
 */

/**
 * Every extracted field carries the model's own certainty alongside the value.
 *
 * TRADEOFF, and it's a real one: wrapping each field in an envelope makes the schema
 * noisier, and there is evidence that asking a model to introspect inline costs a little
 * accuracy on the value itself. The alternative is a parallel `confidence` object keyed
 * by field name. We take the envelope because it makes it structurally impossible to
 * return a value with no confidence attached — the failure mode of the parallel object
 * is silently missing keys.
 *
 * Remember what this number is: the model's self-report. It is the WEAK signal. Week 2
 * adds arithmetic cross-checks, and when the two disagree you trust the arithmetic.
 */
const field = <T extends z.ZodTypeAny>(value: T, describe: string) =>
  z.object({
    value: value.describe(describe),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Your certainty this value is correct, 0-1. Be honest: use <0.5 when the " +
          "document is blurry, the field is ambiguous, or you inferred rather than read it.",
      ),
  });

export const LineItem = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number().describe("Price per unit, before tax, in the invoice currency"),
  amount: z.number().describe("Line total as printed on the invoice. Do NOT compute it — read it."),
  confidence: z.number().min(0).max(1),
});

/**
 * `.nullable()` on every value is intentional and load-bearing.
 *
 * A missing field and a wrongly-guessed field are different errors with different fixes,
 * and if you don't give the model a way to say "not present" it will hallucinate one.
 * Null here means "I looked and it isn't there" — which the eval harness scores as a
 * legitimate answer when the ground truth is also null.
 */
export const RawExtraction = z.object({
  invoiceNumber: field(z.string().nullable(), "Invoice/document number exactly as printed"),
  invoiceDate: field(
    z.string().nullable(),
    "Invoice issue date, normalised to ISO 8601 YYYY-MM-DD. See ground-truth/LABELING.md.",
  ),
  vendor: field(z.string().nullable(), "Legal entity issuing the invoice (who is owed money)"),
  currency: field(z.string().nullable(), "ISO 4217 code, e.g. AUD, USD, EUR"),
  lineItems: field(z.array(LineItem), "Every billable line. Empty array if none are itemised."),
  total: field(z.number().nullable(), "Grand total payable, tax included, as printed"),
});

export type RawExtraction = z.infer<typeof RawExtraction>;
export type LineItem = z.infer<typeof LineItem>;

/** The names the eval harness reports precision/recall against, one row per field. */
export const FIELD_NAMES = [
  "invoiceNumber",
  "invoiceDate",
  "vendor",
  "currency",
  "lineItems",
  "total",
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/**
 * Gemini's `responseJsonSchema` accepts standard JSON Schema but supports only a subset
 * of keywords, and `$schema` isn't one of them. Zod v4 emits it by default, so strip it.
 * This is the kind of small impedance mismatch that makes a thin adapter worth having:
 * when you swap to Claude tool use, only this function changes.
 */
export function toJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(RawExtraction, { target: "draft-2020-12" }) as Record<
    string,
    unknown
  >;
  delete schema["$schema"];
  return schema;
}
