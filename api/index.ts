// server/index.ts
import express from "express";
import bodyParser from "body-parser";
import { Pool } from "pg";

const app = express();
app.use(bodyParser.json());

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? "5432"),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "postgres"
});

const mlBase = (process.env.ML_ASSIST_URL ?? "http://localhost:8000").replace(/\/+$/, "");

async function proxyMl(path: string, body: unknown) {
  const response = await fetch(`${mlBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ML service error ${response.status}: ${text}`);
  }
  return response.json();
}

app.post("/api/ml/recon/score", async (req, res) => {
  try {
    const result = await proxyMl("/ml/recon/score", req.body);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post("/api/ml/forecast/liability", async (req, res) => {
  try {
    const result = await proxyMl("/ml/forecast/liability", req.body);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post("/api/ml/ingest/invoice", async (req, res) => {
  try {
    const result = await proxyMl("/ml/ingest/invoice", req.body);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post("/api/ml/recon/match", async (req, res) => {
  try {
    const result = await proxyMl("/ml/recon/match", req.body);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post("/api/ml/decisions", async (req, res) => {
  const { endpoint, request_hash, response, user_decision, decided_by, notes } = req.body ?? {};
  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    return res.status(400).json({ error: "endpoint is required" });
  }
  if (typeof request_hash !== "string" || request_hash.trim() === "") {
    return res.status(400).json({ error: "request_hash is required" });
  }
  if (!response) {
    return res.status(400).json({ error: "response payload is required" });
  }
  if (user_decision !== "accept" && user_decision !== "override") {
    return res.status(400).json({ error: "user_decision must be 'accept' or 'override'" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ml_decisions (endpoint, request_hash, response, user_decision, decided_by, notes)
       VALUES ($1, $2, $3::jsonb, $4, COALESCE($5, 'operator'), $6)
       RETURNING id, decided_at`,
      [endpoint, request_hash, JSON.stringify(response), user_decision, decided_by, notes]
    );
    res.json({ id: result.rows[0].id, decided_at: result.rows[0].decided_at });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(8080, () => console.log("App on http://localhost:8080"));
