// src/api/index.ts
import { Router } from "express";
import { Pool } from "pg";
import { acknowledgeAlerts, listActiveAlerts, refreshAlerts } from "../alerts/engine";

const pool = new Pool();

export const api = Router();

api.get("/alerts", async (req, res) => {
  const abn = String((req.query.abn ?? "")).trim();
  if (!abn) {
    return res.status(400).json({ error: "abn is required" });
  }
  try {
    await refreshAlerts({ pool, abn });
    const alerts = await listActiveAlerts({ pool, abn });
    res.json({ alerts });
  } catch (err: any) {
    res.status(500).json({ error: "failed to load alerts", detail: err?.message ?? String(err) });
  }
});

api.post("/alerts/ack", async (req, res) => {
  const { abn, ids } = req.body ?? {};
  if (!abn || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "abn and ids are required" });
  }

  const numericIds = ids
    .map((id: unknown) => (typeof id === "number" ? id : Number(id)))
    .filter((id: number) => Number.isFinite(id)) as number[];

  if (!numericIds.length) {
    return res.status(400).json({ error: "ids must contain numeric values" });
  }

  try {
    const acknowledged = await acknowledgeAlerts({ pool, abn: String(abn), ids: numericIds });
    res.json({ acknowledged });
  } catch (err: any) {
    res.status(500).json({ error: "failed to acknowledge alerts", detail: err?.message ?? String(err) });
  }
});
