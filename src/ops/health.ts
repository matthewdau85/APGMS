import { Router } from "express";
import client from "prom-client";

export const ops = Router();

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

ops.get("/healthz", (_req, res) => res.json({ ok: true }));
ops.get("/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

export { registry as metrics };
