import express from "express";

const complianceApi = express.Router();

const GATE_BASE = (process.env.GATE_BASE_URL || "http://localhost:8101").replace(/\/$/, "");
const AUDIT_BASE = (process.env.AUDIT_BASE_URL || "http://localhost:8104").replace(/\/$/, "");

async function forward(url: URL | string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error(`Invalid JSON from upstream: ${(err as Error).message}`);
    }
  }
  if (!res.ok) {
    const message = (json && (json.error || json.detail)) || res.statusText || "Upstream request failed";
    throw new Error(String(message));
  }
  return json;
}

complianceApi.get("/gate/transition", async (req, res) => {
  try {
    const { period_id, periodId } = req.query as Record<string, string | undefined>;
    const pid = period_id || periodId;
    if (!pid) {
      return res.status(400).json({ error: "Missing period_id" });
    }
    const target = new URL(`${GATE_BASE}/gate/transition`);
    target.searchParams.set("period_id", pid);
    const data = await forward(target);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err?.message || "Gate transition fetch failed" });
  }
});

complianceApi.get("/audit/bundle/:periodId", async (req, res) => {
  try {
    const { periodId } = req.params;
    const target = `${AUDIT_BASE}/audit/bundle/${encodeURIComponent(periodId)}`;
    const data = await forward(target);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err?.message || "Audit bundle fetch failed" });
  }
});

export { complianceApi };
