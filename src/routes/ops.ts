import { Router } from "express";
import { fetchRecentActivity, recordActivity } from "../ops/activity";
import { listPendingApprovals, decideApproval } from "../ops/approvals";
import { replayDlq } from "../ops/dlq";

export const opsRouter = Router();

opsRouter.get("/activity", async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const items = await fetchRecentActivity(limit);
    res.json({ items });
  } catch (err:any) {
    res.status(500).json({ error: err?.message || "ACTIVITY_ERROR" });
  }
});

opsRouter.get("/approvals/pending", async (_req, res) => {
  try {
    const approvals = await listPendingApprovals();
    res.json({ approvals });
  } catch (err:any) {
    res.status(500).json({ error: err?.message || "APPROVALS_ERROR" });
  }
});

function requireComment(comment: any) {
  if (typeof comment !== "string") return "COMMENT_REQUIRED";
  const trimmed = comment.trim();
  if (!trimmed) return "COMMENT_REQUIRED";
  return trimmed;
}

opsRouter.post("/approvals/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "INVALID_ID" });
  }
  const comment = requireComment(req.body?.comment);
  if (comment === "COMMENT_REQUIRED") {
    return res.status(400).json({ error: "COMMENT_REQUIRED" });
  }
  const actor = (typeof req.body?.actor === "string" && req.body.actor.trim()) || "ops-ui";
  try {
    const approval = await decideApproval(id, "APPROVED", comment as string, actor);
    await recordActivity("ops", "approval_decision", "SUCCESS", {
      id: approval.id,
      status: approval.status,
      actor,
      comment
    });
    res.json({ approval });
  } catch (err:any) {
    const message = err?.message || "APPROVAL_ERROR";
    const code = message === "APPROVAL_NOT_FOUND" ? 404 : 400;
    if (code !== 404) {
      await recordActivity("ops", "approval_decision", "FAILED", { id, actor, error: message });
    }
    res.status(code).json({ error: message });
  }
});

opsRouter.post("/approvals/:id/decline", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "INVALID_ID" });
  }
  const comment = requireComment(req.body?.comment);
  if (comment === "COMMENT_REQUIRED") {
    return res.status(400).json({ error: "COMMENT_REQUIRED" });
  }
  const actor = (typeof req.body?.actor === "string" && req.body.actor.trim()) || "ops-ui";
  try {
    const approval = await decideApproval(id, "DECLINED", comment as string, actor);
    await recordActivity("ops", "approval_decision", "SUCCESS", {
      id: approval.id,
      status: approval.status,
      actor,
      comment
    });
    res.json({ approval });
  } catch (err:any) {
    const message = err?.message || "APPROVAL_ERROR";
    const code = message === "APPROVAL_NOT_FOUND" ? 404 : 400;
    if (code !== 404) {
      await recordActivity("ops", "approval_decision", "FAILED", { id, actor, error: message });
    }
    res.status(code).json({ error: message });
  }
});

opsRouter.post("/dlq/replay/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "INVALID_ID" });
  }
  try {
    const result = await replayDlq(id);
    res.json(result);
  } catch (err:any) {
    const message = err?.message || "DLQ_ERROR";
    const code = message === "DLQ_NOT_FOUND" ? 404 : 400;
    res.status(code).json({ error: message });
  }
});
