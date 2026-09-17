import { describe, expect, it } from "vitest";
import { REVIEW_THRESHOLD, scoreExtraction, scoreTotal, TOLERANCE } from "../score.js";
import type { RawExtraction } from "../schema.js";

/**
 * These tests pin the CONTRACT of the arithmetic cross-check, not its arithmetic.
 * The interesting cases are the edges: what does "cannot check" look like versus
 * "checked and failed"? If those two ever collapse into one value, the eval harness
 * loses the ability to say *why* a field was routed to review.
 */
describe("scoreTotal: do the line items sum to the total?", () => {
  it("passes when amounts sum exactly to the total", () => {
    expect(scoreTotal([20, 30], 50)).toEqual({ ok: true, delta: 0 });
  });

  it("passes within one cent: rounding, not a real discrepancy", () => {
    // 19.995 + 30 = 49.995. Printed totals are rounded to cents; the check must be too.
    expect(scoreTotal([19.995, 30], 50)?.ok).toBe(true);
  });

  it("fails when the gap exceeds tolerance, and reports the signed gap", () => {
    // Sign matters: total > sum smells like missing tax or a missed line item;
    // total < sum smells like a misread digit. Different failure, different fix.
    expect(scoreTotal([20, 30], 55)).toEqual({ ok: false, delta: 5 });
    expect(scoreTotal([20, 30], 45)).toEqual({ ok: false, delta: -5 });
  });

  it("does not accumulate floating-point noise across many lines", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754. Ten lines of 0.1 must still equal 1.00.
    expect(scoreTotal(Array(10).fill(0.1), 1)).toEqual({ ok: true, delta: 0 });
  });

  it("returns null, not false, when total is null: no evidence is not counter-evidence", () => {
    expect(scoreTotal([20, 30], null)).toBeNull();
  });

  it("returns null when there are no line items: nothing to sum", () => {
    expect(scoreTotal([], 50)).toBeNull();
  });

  it("keeps tolerance at one cent so missing tax cannot hide inside it", () => {
    // If someone widens this to absorb GST (10%), the check passes by construction
    // on every taxed invoice and stops being a signal. Add a subtotal field instead.
    expect(TOLERANCE).toBe(0.01);
  });
});


/** A clean, self-consistent extraction. Tests override one thing at a time from here. */
function extraction(overrides: Partial<RawExtraction> = {}): RawExtraction {
  return {
    invoiceNumber: { value: "INV-1", confidence: 1 },
    invoiceDate: { value: "2026-09-17", confidence: 1 },
    vendor: { value: "Acme Pty Ltd", confidence: 1 },
    currency: { value: "AUD", confidence: 1 },
    lineItems: {
      value: [
        { description: "A", quantity: 1, unitPrice: null, amount: 20, confidence: 1 },
        { description: "B", quantity: 1, unitPrice: null, amount: 30, confidence: 1 },
      ],
      confidence: 1,
    },
    total: { value: 50, confidence: 1 },
    ...overrides,
  };
}

describe("scoreExtraction: which fields go to the review queue?", () => {
  it("routes nothing when every signal is clean", () => {
    expect(scoreExtraction(extraction()).needsReview).toEqual([]);
  });

  it("routes a field whose self-reported confidence is below threshold", () => {
    const scored = scoreExtraction(extraction({ vendor: { value: "Acme", confidence: 0.4 } }));
    expect(scored.needsReview).toEqual(["vendor"]);
  });

  it("routes BOTH total and lineItems when the arithmetic fails, because we cannot tell which is wrong", () => {
    const scored = scoreExtraction(extraction({ total: { value: 55, confidence: 1 } }));
    expect(scored.needsReview).toEqual(["lineItems", "total"]);
  });

  it("the computed check overrides a confident self-report, not the other way round", () => {
    // Model says 1.0 on total, arithmetic says no. Arithmetic wins.
    const scored = scoreExtraction(extraction({ total: { value: 55, confidence: 1 } }));
    expect(scored.selfReported.total).toBe(1);
    expect(scored.computed.total?.ok).toBe(false);
    expect(scored.needsReview).toContain("total");
  });

  it("does not route on a null check: an un-itemised invoice is not a failed one", () => {
    const scored = scoreExtraction(extraction({ lineItems: { value: [], confidence: 1 } }));
    expect(scored.computed.total).toBeNull();
    expect(scored.needsReview).toEqual([]);
  });

  it("keeps both signals in the output so the harness can compare them", () => {
    const scored = scoreExtraction(extraction());
    expect(Object.keys(scored.selfReported).sort()).toEqual(
      ["currency", "invoiceDate", "invoiceNumber", "lineItems", "total", "vendor"],
    );
    expect(scored.computed.total).toEqual({ ok: true, delta: 0 });
  });

  it("threshold is a named constant, not a magic number", () => {
    expect(REVIEW_THRESHOLD).toBeGreaterThan(0);
    expect(REVIEW_THRESHOLD).toBeLessThan(1);
  });
});
