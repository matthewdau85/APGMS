import type { Request, Response } from "express";
import { selectBankProvider } from "@providers/bank/index.js";

export async function ingestBankStatement(req: Request, res: Response) {
  try {
    const provider = selectBankProvider();
    const { content, filename, contentType, encoding } = (req.body ?? {}) as {
      content?: string;
      filename?: string;
      contentType?: string;
      encoding?: "base64" | "utf8";
    };

    if (!content) {
      return res.status(400).json({ error: "Missing statement content" });
    }

    const body = encoding === "base64" ? Buffer.from(content, "base64") : content;
    await provider.statements.ingestHttp({
      body,
      filename,
      contentType: contentType ?? req.get("content-type") ?? "application/json",
    });

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to ingest bank statement", detail: String(error?.message ?? error) });
  }
}
