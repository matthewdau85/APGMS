import { extractOcrLines } from "./ocr";
import { inferSuggestions } from "./ner";
import { persistDerivedFeatures } from "./store";
import { InvoiceIngestRequest, InvoiceIngestResponse } from "./types";

export async function ingestInvoice(request: InvoiceIngestRequest): Promise<InvoiceIngestResponse> {
  const buffer = Buffer.from(request.content, "base64");
  const ocrLines = await extractOcrLines(buffer, request.mime);
  const suggestions = inferSuggestions(ocrLines);
  const sanitized = suggestions.map((suggestion) => ({
    ...suggestion,
    desc: stripPiiTokens(suggestion.desc),
  }));
  persistDerivedFeatures(request.doc_id, sanitized);
  return {
    lines: sanitized,
    advisory: true,
  };
}

function stripPiiTokens(text: string): string {
  return text
    .replace(/\b\d{3}[- ]?\d{3}[- ]?\d{3}\b/g, "[ABN]")
    .replace(/\b\d{2,3}[- ]?\d{3}[- ]?\d{3}\b/g, "[PHONE]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .trim();
}
