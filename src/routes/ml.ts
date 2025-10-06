import express from "express";
import { ingestInvoice } from "../ml/pipeline";
import { InvoiceIngestRequest } from "../ml/types";

export const mlRouter = express.Router();

mlRouter.post("/ingest/invoice", async (req, res) => {
  try {
    const body = req.body as Partial<InvoiceIngestRequest>;
    if (!body?.doc_id || !body?.mime || !body?.content) {
      return res.status(400).json({ error: "doc_id, mime and content are required" });
    }
    const response = await ingestInvoice(body as InvoiceIngestRequest);
    res.json(response);
  } catch (err) {
    console.error("[ml] ingest invoice failed", err);
    res.status(500).json({ error: "Failed to ingest invoice" });
  }
});
