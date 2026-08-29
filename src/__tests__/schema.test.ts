import { describe, expect, it } from "vitest";
import { RawExtraction, toJsonSchema } from "../schema.js";

/**
 * Gemini's responseJsonSchema accepts JSON Schema but honours only these keywords.
 * Anything else is, at best, ignored — at worst a 400 partway through an eval run.
 * Source: the responseJsonSchema docstring in @google/genai.
 */
const GEMINI_SUPPORTED = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description",
  "enum", "items", "prefixItems", "minItems", "maxItems", "minimum", "maximum",
  "anyOf", "oneOf", "properties", "additionalProperties", "required", "propertyOrdering",
]);

function collectKeywords(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) collectKeywords(item, found);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      found.add(key);
      // Don't descend into `properties`/`$defs` KEYS — those are field names like
      // "invoiceNumber", not schema keywords. Only their values are schemas.
      collectKeywords(value, found);
    }
  }
  return found;
}

describe("toJsonSchema", () => {
  it("emits only keywords Gemini supports", () => {
    const schema = toJsonSchema();
    // Field names appear as keys too, so exclude anything we know is a property name.
    const propertyNames = new Set<string>();
    (function walk(n: unknown): void {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      const obj = n as Record<string, unknown>;
      for (const container of ["properties", "$defs"] as const) {
        const c = obj[container];
        if (c && typeof c === "object") for (const k of Object.keys(c)) propertyNames.add(k);
      }
      for (const v of Object.values(obj)) walk(v);
    })(schema);

    const unsupported = [...collectKeywords(schema)].filter(
      (k) => !GEMINI_SUPPORTED.has(k) && !propertyNames.has(k),
    );
    expect(unsupported).toEqual([]);
  });

  it("drops $schema, which Gemini rejects", () => {
    expect(toJsonSchema()).not.toHaveProperty("$schema");
  });
});

describe("RawExtraction", () => {
  const valid = {
    invoiceNumber: { value: "INV-0042", confidence: 0.98 },
    invoiceDate: { value: "2026-08-29", confidence: 0.91 },
    vendor: { value: "Acme Pty Ltd", confidence: 0.95 },
    currency: { value: "AUD", confidence: 0.99 },
    lineItems: {
      value: [{ description: "Widget", quantity: 2, unitPrice: 10, amount: 20, confidence: 0.9 }],
      confidence: 0.9,
    },
    total: { value: 22, confidence: 0.97 },
  };

  it("accepts a well-formed extraction", () => {
    expect(RawExtraction.parse(valid)).toEqual(valid);
  });

  it("accepts nulls — 'absent' is a legitimate answer, not an error", () => {
    const parsed = RawExtraction.parse({
      ...valid,
      invoiceNumber: { value: null, confidence: 0.1 },
    });
    expect(parsed.invoiceNumber.value).toBeNull();
  });

  it("rejects confidence outside 0-1", () => {
    expect(() =>
      RawExtraction.parse({ ...valid, total: { value: 22, confidence: 1.4 } }),
    ).toThrow();
  });

  it("rejects a value with no confidence — the envelope is the point", () => {
    expect(() => RawExtraction.parse({ ...valid, total: { value: 22 } })).toThrow();
  });

  it("does NOT reconcile: line items summing to 20 with a total of 22 is valid input", () => {
    // Week 2's arithmetic cross-check will FLAG this. The schema must not reject it,
    // or the most interesting documents never reach the scorer.
    expect(() => RawExtraction.parse(valid)).not.toThrow();
  });
});
