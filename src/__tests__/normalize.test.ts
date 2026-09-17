import { describe, expect, it } from "vitest";
import {
  canonicalAmount,
  canonicalCurrency,
  canonicalDate,
  canonicalEquals,
  canonicalText,
  canonicalVendor,
} from "../normalize.js";

describe("canonicalVendor", () => {
  it("folds the exact mismatch from the first live run", () => {
    // The model returned "ACME PTY LTD"; the label said "Acme Pty Ltd".
    // Both are correct transcriptions under different conventions.
    expect(canonicalVendor("ACME PTY LTD")).toBe(canonicalVendor("Acme Pty Ltd"));
  });

  it("folds trailing periods in entity suffixes", () => {
    expect(canonicalVendor("Acme Pty. Ltd.")).toBe(canonicalVendor("Acme Pty Ltd"));
  });

  it("folds & and 'and'", () => {
    expect(canonicalVendor("Smith & Sons")).toBe(canonicalVendor("Smith and Sons"));
  });

  it("does NOT merge distinct entities that share a stem", () => {
    // Stripping the suffix would collapse these. Merging two real companies is a
    // much worse error than failing to merge one.
    expect(canonicalVendor("Acme Pty Ltd")).not.toBe(canonicalVendor("Acme Holdings Ltd"));
  });

  it("folds non-breaking spaces, which are invisible in a terminal", () => {
    expect(canonicalVendor("Acme Pty Ltd")).toBe(canonicalVendor("Acme Pty Ltd"));
  });
});

describe("canonicalText", () => {
  it("folds em dash and en dash to hyphen", () => {
    expect(canonicalText("Widget assembly — series B")).toBe(
      canonicalText("Widget assembly - series B"),
    );
  });

  it("collapses runs of whitespace", () => {
    expect(canonicalText("Freight   &  handling")).toBe(canonicalText("Freight & handling"));
  });
});

describe("canonicalAmount", () => {
  it("treats 379.5 and 379.50 as equal", () => {
    expect(canonicalAmount(379.5)).toBe(canonicalAmount(379.50));
  });

  it("survives float noise", () => {
    expect(canonicalAmount(0.1 + 0.2)).toBe(0.3);
  });
});

describe("canonicalDate", () => {
  it("passes ISO through", () => {
    expect(canonicalDate("2026-08-29")).toBe("2026-08-29");
  });

  it("throws rather than guessing an ambiguous format", () => {
    // 03/04/2026 is 3 April in AU and 4 March in the US. Coercing silently is how
    // a wrong date becomes a plausible answer nobody notices.
    expect(() => canonicalDate("03/04/2026")).toThrow(/ISO 8601/);
  });
});

describe("canonicalCurrency", () => {
  it("uppercases", () => {
    expect(canonicalCurrency("aud")).toBe("AUD");
  });
});

describe("canonicalEquals", () => {
  it("matches null against null — 'absent' is a correct answer", () => {
    expect(canonicalEquals(null, null, "vendor")).toBe(true);
  });

  it("does not match null against a value", () => {
    expect(canonicalEquals(null, "Acme Pty Ltd", "vendor")).toBe(false);
  });

  it("resolves the first live run's vendor field to a match", () => {
    expect(canonicalEquals("ACME PTY LTD", "Acme Pty Ltd", "vendor")).toBe(true);
  });
});
