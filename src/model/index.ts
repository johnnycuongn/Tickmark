import type { ExtractionAdapter } from "./adapter.js";
import { GeminiAdapter } from "./gemini.js";

export type { Document, ExtractionAdapter, ExtractionResult } from "./adapter.js";
export { GeminiAdapter } from "./gemini.js";

/**
 * The only place that decides which model runs. When you add a Claude adapter, this
 * switch grows one arm and nothing else in the project changes — that is the test of
 * whether the seam in adapter.ts was drawn in the right place.
 */
export function createAdapter(provider = process.env["MODEL_PROVIDER"] ?? "gemini"): ExtractionAdapter {
  switch (provider) {
    case "gemini": {
      const apiKey = process.env["GEMINI_API_KEY"];
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and fill it in.");
      }
      const model = process.env["GEMINI_MODEL"];
      return new GeminiAdapter(model ? { apiKey, model } : { apiKey });
    }
    default:
      throw new Error(`Unknown MODEL_PROVIDER: ${provider}`);
  }
}
