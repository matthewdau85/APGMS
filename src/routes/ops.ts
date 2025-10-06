import express from "express";
import { Request, Response } from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { createJob, getJob, listJobs, retryJob, startOpsWorker, subscribe } from "../ops/service";
import { OpsJobEvent, OpsJobType } from "../types/ops";

startOpsWorker();

export const opsRouter = express.Router();

const DEFAULT_LIMIT = 50;

opsRouter.post("/seed", requireAdmin, async (req, res) => {
  await enqueueJob(req, res, "seed", req.body || {});
});

opsRouter.post("/smoke", requireAdmin, async (req, res) => {
  await enqueueJob(req, res, "smoke", req.body || {});
});

opsRouter.post("/replay", requireAdmin, async (req, res) => {
  const params = req.body || {};
  await enqueueJob(req, res, "replay", params);
});

opsRouter.post("/rules/bump", requireAdmin, async (req, res) => {
  await enqueueJob(req, res, "rules_bump", req.body || {});
});

opsRouter.post("/openapi/regenerate", requireAdmin, async (req, res) => {
  await enqueueJob(req, res, "openapi_regenerate", req.body || {});
});

opsRouter.post("/docs/validate", requireAdmin, async (req, res) => {
  await enqueueJob(req, res, "docs_validate", req.body || {});
});

opsRouter.get("/jobs", requireAdmin, async (req, res) => {
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 200)
    : DEFAULT_LIMIT;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !["queued", "running", "succeeded", "failed"].includes(status)) {
    return res.status(400).json({ error: "INVALID_STATUS" });
  }
  const jobs = await listJobs(limit, status);
  res.json({ jobs });
});

opsRouter.get("/jobs/:id", requireAdmin, async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  res.json({ job });
});

opsRouter.post("/jobs/:id/retry", requireAdmin, async (req, res) => {
  try {
    const ctx = req.adminContext!;
    const job = await retryJob(req.params.id, ctx.subject, ctx.approver, ctx.mfaVerifiedAt);
    res.json(job);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "RETRY_FAILED" });
  }
});

opsRouter.get("/jobs/:id/stream", requireAdmin, async (req: Request, res: Response) => {
  const job = await getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  setupSse(res);
  pushEvent(res, {
    jobId: job.id,
    emittedAt: new Date().toISOString(),
    type: "bootstrap",
    job,
  });
  const unsubscribe = subscribe(job.id, (event) => {
    pushEvent(res, event);
  });
  req.on("close", () => {
    unsubscribe();
    res.end();
  });
});

async function enqueueJob(req: Request, res: Response, type: OpsJobType, params: Record<string, any>) {
  const ctx = req.adminContext!;
  if (type === "replay") {
    const ids = Array.isArray(params.ids) ? params.ids : [];
    params = { ...params, ids: ids.map((id) => String(id)) };
  }
  const requiresDual = shouldRequireDual(type, params);
  if (requiresDual) {
    if (!ctx.approver) {
      return res.status(403).json({ error: "DUAL_APPROVAL_REQUIRED" });
    }
    if (ctx.approver === ctx.subject) {
      return res.status(403).json({ error: "SOD_VIOLATION" });
    }
  }
  try {
    const job = await createJob({
      type,
      params,
      actor: ctx.subject,
      approver: ctx.approver,
      requiresDual,
      mfaVerifiedAt: ctx.mfaVerifiedAt,
    });
    res.status(202).json(job);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "JOB_CREATION_FAILED" });
  }
}

function shouldRequireDual(type: OpsJobType, params: Record<string, any>): boolean {
  if (type === "replay") {
    const threshold = Number(process.env.OPS_REPLAY_DUAL_THRESHOLD || 10);
    const ids = Array.isArray(params.ids) ? params.ids : [];
    if (ids.length >= threshold) {
      return true;
    }
  }
  return Boolean(params.requiresDual);
}

function setupSse(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function pushEvent(res: Response, event: OpsJobEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
