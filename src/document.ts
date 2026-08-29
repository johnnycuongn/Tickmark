import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { Document } from "./model/adapter.js";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * The document id is the filename without extension, and that is a convention the whole
 * project leans on: ground-truth/docs/acme-0042.pdf pairs with
 * ground-truth/labels/acme-0042.json. Joining on filename keeps the eval harness free of
 * a manifest file that can drift out of sync with the directory.
 */
export async function loadDocument(path: string): Promise<Document> {
  const ext = extname(path).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    throw new Error(`Unsupported file type "${ext}". Supported: ${Object.keys(MIME_BY_EXT).join(", ")}`);
  }
  return { bytes: await readFile(path), mimeType, id: basename(path, ext) };
}
