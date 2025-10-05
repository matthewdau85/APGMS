import { Router } from "express";

const TAX_ENGINE_BASE =
  process.env.TAX_ENGINE_BASE_URL || "http://localhost:8002";

async function forward(path: string, body: unknown) {
  const res = await fetch(`${TAX_ENGINE_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    json = { raw: text };
  }
  if (!res.ok) {
    const message = (json && (json.error || json.detail)) || text || "Tax engine error";
    const error = new Error(String(message));
    (error as any).status = res.status;
    throw error;
  }
  return json;
}

export const taxEngineApi = Router();

taxEngineApi.post("/tax/gst", async (req, res) => {
  try {
    const data = await forward("/api/gst", req.body);
    res.json(data);
  } catch (err: any) {
    res
      .status(err?.status || 502)
      .json({ error: err?.message || "GST calculation failed" });
  }
});

taxEngineApi.post("/tax/paygw", async (req, res) => {
  try {
    const data = await forward("/api/paygw", req.body);
    res.json(data);
  } catch (err: any) {
    res
      .status(err?.status || 502)
      .json({ error: err?.message || "PAYGW calculation failed" });
  }
});
