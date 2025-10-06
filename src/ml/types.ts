export interface OcrLine {
  text: string;
  confidence: number;
}

export interface InvoiceLineSuggestion {
  desc: string;
  amount: number | null;
  gstRateSuggested: number | null;
  confidence: number;
  rationale?: string;
}

export interface InvoiceIngestRequest {
  doc_id: string;
  mime: string;
  content: string; // base64 encoded
}

export interface InvoiceIngestResponse {
  lines: InvoiceLineSuggestion[];
  advisory: true;
}
