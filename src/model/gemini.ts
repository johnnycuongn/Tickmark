import { GoogleGenAI } from "@google/genai";
import type { Document, ExtractionAdapter, ExtractionResult } from "./adapter.js";
import { RawExtraction, toJsonSchema } from "../schema.js";

/**
 * The prompt is short on purpose.
 *
 * A common beginner move is to describe every field at length in the prompt. Don't — the
 * schema already carries the field descriptions (see the .describe() calls in schema.ts),
 * and Gemini receives them as part of responseJsonSchema. Duplicating them here creates
 * two places to edit and lets them disagree.
 *
 * What belongs in the prompt is the stuff a schema can't express: the reading posture,
 * and the rules about what NOT to do.
 */
const SYSTEM_PROMPT = `You extract structured data from invoices and receipts.

Read the document as an image. Report only what is printed on it.

Rules:
- Transcribe values as printed. Do not compute, correct, or reconcile anything.
- If the line items do not add up to the printed total, report both as printed anyway.
  Detecting that mismatch is a downstream job, not yours. Silently "fixing" it destroys
  the signal.
- If a field is genuinely absent, return null. Never invent a plausible value.
- Lower your confidence when the scan is poor, the layout is ambiguous, or you are
  inferring from context rather than reading a label.`;

export interface GeminiOptions {
  apiKey: string;
  /** Default gemini-2.5-flash: native PDF/image input, generous free tier. */
  model?: string;
}

export class GeminiAdapter implements ExtractionAdapter {
  readonly name: string;
  readonly #client: GoogleGenAI;
  readonly #model: string;
  readonly #schema: Record<string, unknown>;

  constructor(opts: GeminiOptions) {
    this.#client = new GoogleGenAI({ apiKey: opts.apiKey });
    this.#model = opts.model ?? "gemini-2.5-flash";
    this.name = `gemini:${this.#model}`;
    // Compiled once. Cheap, but it also means a schema error surfaces at construction
    // rather than on the 14th document of an eval run.
    this.#schema = toJsonSchema();
  }

  async extract(doc: Document): Promise<ExtractionResult> {
    const startedAt = performance.now();

    const response = await this.#client.models.generateContent({
      model: this.#model,
      contents: [
        {
          role: "user",
          parts: [
            // The PDF goes in as bytes. We are NOT pre-OCRing it: the model reads layout,
            // and layout is most of what tells you a number is a total rather than a
            // line amount. An OCR pass flattens the page to a string and throws that away.
            {
              inlineData: {
                mimeType: doc.mimeType,
                data: Buffer.from(doc.bytes).toString("base64"),
              },
            },
            { text: "Extract the invoice fields from this document." },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        // These two together are what force structured output. Without responseMimeType
        // the schema is ignored; without the schema you are parsing JSON out of prose and
        // writing regex fallbacks forever.
        responseMimeType: "application/json",
        responseJsonSchema: this.#schema,
        // Extraction is a transcription task, not a creative one. Temperature 0 also makes
        // eval runs comparable — otherwise a "regression" might just be a different sample.
        temperature: 0,
      },
    });

    const latencyMs = Math.round(performance.now() - startedAt);
    const text = response.text;
    if (!text) {
      throw new Error(
        `[${this.name}] empty response for ${doc.id} ` +
          `(finishReason=${response.candidates?.[0]?.finishReason ?? "unknown"})`,
      );
    }

    // Parse and validate separately from the network call, so the error message can tell
    // you WHICH of the two failed. "Model returned unparseable JSON" and "model returned
    // JSON that violates the schema" are different bugs.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`[${this.name}] response was not valid JSON for ${doc.id}: ${text.slice(0, 400)}`);
    }

    // Belt and braces. responseJsonSchema is a strong constraint, not a guarantee — and
    // when it does fail you want a typed error here, not an undefined three layers away.
    const extraction = RawExtraction.parse(parsed);

    return {
      documentId: doc.id,
      extraction,
      rawResponseText: text,
      model: this.#model,
      latencyMs,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}
