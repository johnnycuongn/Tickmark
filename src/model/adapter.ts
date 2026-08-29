import type { RawExtraction } from "../schema.js";

/** A document as bytes. Deliberately NOT a file path — the eval harness holds buffers. */
export interface Document {
  bytes: Uint8Array;
  /** e.g. "application/pdf", "image/png". Drives how the model treats the input. */
  mimeType: string;
  /** Stable id used to join an extraction back to its ground-truth label. */
  id: string;
}

/**
 * Everything we keep from one extraction run.
 *
 * Note what's here beyond the parsed fields. `rawResponseText` is the model's literal
 * output before parsing, and it is kept on purpose: when the eval harness shows a field
 * regressed, the first question is always "did the model say something different, or did
 * our parsing change?" You cannot answer that without the raw text.
 *
 * This is the same instinct as the raw-vs-corrected column split in the database. Keep
 * the upstream artifact; derived values can always be recomputed, inputs cannot.
 */
export interface ExtractionResult {
  documentId: string;
  extraction: RawExtraction;
  rawResponseText: string;
  /** Which model produced this, e.g. "gemini-2.5-flash". Eval rows are meaningless without it. */
  model: string;
  latencyMs: number;
  /**
   * `?: T | undefined` rather than `?: T` — under exactOptionalPropertyTypes those differ.
   * The first says "may be absent OR explicitly unknown", which is the truth: the provider
   * does not always report usage. The second would force a cast at every call site.
   */
  usage: { inputTokens?: number | undefined; outputTokens?: number | undefined };
}

/**
 * The seam. Swapping Gemini for Claude tool use should touch exactly one file that
 * implements this, plus the factory in ./index.ts — nothing else in the codebase.
 *
 * Note the interface says nothing about prompts, schemas-as-OpenAPI, safety settings,
 * or parts/blobs. Those are Gemini vocabulary. An abstraction that leaks its first
 * implementation's vocabulary is not an abstraction, it's a rename.
 */
export interface ExtractionAdapter {
  readonly name: string;
  extract(doc: Document): Promise<ExtractionResult>;
}
