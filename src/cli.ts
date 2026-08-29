import "dotenv/config";
import { loadDocument } from "./document.js";
import { createAdapter } from "./model/index.js";

/** Usage: npm run extract -- ground-truth/docs/acme-0042.pdf */
async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npm run extract -- <path-to-pdf-or-image>");
    process.exitCode = 1;
    return;
  }

  const adapter = createAdapter();
  const doc = await loadDocument(path);
  const result = await adapter.extract(doc);

  // stdout gets machine-readable JSON, stderr gets the human summary. That split means
  // `npm run extract -- foo.pdf > out.json` just works.
  console.log(JSON.stringify(result.extraction, null, 2));
  console.error(
    `\n${result.model}  ${result.latencyMs}ms  ` +
      `in=${result.usage.inputTokens ?? "?"} out=${result.usage.outputTokens ?? "?"}`,
  );
}

await main();
