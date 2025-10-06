import { Router } from "express";
import { getManifest, getChunk, CodexManifestEntry, CodexChunk } from "../docs/codexFeed";

export const atoCodex = Router();

atoCodex.get("/manifest", async (req, res) => {
  try {
    const limitRaw = req.query.limit as string | undefined;
    const includePreview = String(req.query.preview ?? "false").toLowerCase() === "true";
    const previewLengthRaw = req.query.previewLength as string | undefined;

    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const previewLength = previewLengthRaw ? Number.parseInt(previewLengthRaw, 10) : 240;

    const fullManifest: CodexManifestEntry[] = await getManifest();
    let manifest: CodexManifestEntry[] = fullManifest;
    let truncated = false;

    if (limit && Number.isFinite(limit) && limit > 0) {
      truncated = fullManifest.length > limit;
      manifest = fullManifest.slice(0, limit);
    }

    if (includePreview) {
      const entriesWithPreview: CodexChunk[] = await Promise.all(
        manifest.map((entry) => getChunk(entry.order, previewLength))
      );
      return res.json({ total: fullManifest.length, truncated, entries: entriesWithPreview });
    }

    return res.json({ total: fullManifest.length, truncated, entries: manifest });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    res.status(500).json({ error: message });
  }
});

atoCodex.get("/chunk/:order", async (req, res) => {
  try {
    const order = Number.parseInt(req.params.order, 10);
    const previewLengthRaw = req.query.previewLength as string | undefined;
    const previewLength = previewLengthRaw ? Number.parseInt(previewLengthRaw, 10) : 240;
    const chunk = await getChunk(order, previewLength);
    res.json(chunk);
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    if (error instanceof Error && error.message === "ORDER_OUT_OF_RANGE") {
      return res.status(400).json({ error: "ORDER_OUT_OF_RANGE" });
    }
    if (error instanceof Error && error.message === "CHUNK_FILE_MISSING") {
      return res.status(500).json({ error: "CHUNK_FILE_MISSING" });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    res.status(500).json({ error: message });
  }
});
