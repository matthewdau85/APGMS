import { Request, Response } from "express";
import { listPendingAnomalies, updateOperatorNote } from "../anomaly/pendingQueue";

export function pendingAnomalies(_req: Request, res: Response) {
  res.json({ anomalies: listPendingAnomalies() });
}

export function saveOperatorNote(req: Request, res: Response) {
  const { id } = req.params;
  const { note } = req.body ?? {};
  if (typeof id !== "string" || id.length === 0) {
    return res.status(400).json({ error: "INVALID_ID" });
  }
  if (typeof note !== "string") {
    return res.status(400).json({ error: "INVALID_NOTE" });
  }
  const updated = updateOperatorNote(id, note.trim());
  if (!updated) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  res.json({ anomaly: updated });
}
