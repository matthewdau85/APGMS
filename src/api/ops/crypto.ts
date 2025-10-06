import { Router } from "express";
import { appendAudit } from "../../audit/appendOnly";
import {
  addKey,
  activateKey,
  retireKey,
  listKeys,
  getPublicKeys,
  runRotationDrill,
  getLastRotationDrill,
} from "../../crypto/kms";

const OPS_TOKEN = process.env.OPS_ROTATE_TOKEN;

function ensureOpsAuth(req: any) {
  const token = req.headers["x-ops-auth"];
  const mfa = req.headers["x-ops-mfa"];
  const actor = req.headers["x-ops-actor"];
  const approver = req.headers["x-ops-approver"];
  if (!OPS_TOKEN || token !== OPS_TOKEN) {
    const err: any = new Error("Unauthorized");
    err.status = 403;
    throw err;
  }
  if (!mfa || String(mfa).length < 6) {
    const err: any = new Error("MFA required");
    err.status = 403;
    throw err;
  }
  if (!actor || !approver || String(actor) === String(approver)) {
    const err: any = new Error("SoD violation");
    err.status = 403;
    throw err;
  }
  return { actor: String(actor), approver: String(approver) };
}

export const opsCryptoRouter = Router();

opsCryptoRouter.get("/keyset", async (_req, res) => {
  const keys = await getPublicKeys();
  res.json({ keys });
});

opsCryptoRouter.get("/keys", async (_req, res) => {
  const keys = await listKeys();
  res.json({ keys });
});

opsCryptoRouter.get("/drill", async (_req, res) => {
  const last = await getLastRotationDrill();
  if (!last) return res.status(404).json({ error: "NO_ROTATION_DRILL" });
  res.json(last);
});

opsCryptoRouter.post("/rotate", async (req, res) => {
  try {
    const { actor, approver } = ensureOpsAuth(req);
    const stage = (req.body?.stage ?? "drill") as string;
    const graceDays = Number(req.body?.graceDays ?? process.env.RPT_KID_GRACE_DAYS ?? "7");

    if (stage === "prepare") {
      const created = await addKey();
      await appendAudit(actor, "kms.rotate.prepare", { approver, kid: created.kid });
      return res.json({ ok: true, pendingKid: created.kid });
    }

    if (stage === "cutover") {
      const kid = req.body?.kid as string;
      if (!kid) return res.status(400).json({ error: "Missing kid" });
      const graceUntil = new Date(Date.now() + graceDays * 86400000);
      const result = await activateKey(kid, graceUntil);
      await appendAudit(actor, "kms.rotate.cutover", {
        approver,
        kid,
        previousKid: result?.previousKid ?? null,
        graceUntil: graceUntil.toISOString(),
      });
      return res.json({ ok: true, kid, previousKid: result?.previousKid ?? null, graceUntil: graceUntil.toISOString() });
    }

    if (stage === "retire") {
      const kid = req.body?.kid as string;
      if (!kid) return res.status(400).json({ error: "Missing kid" });
      await retireKey(kid);
      await appendAudit(actor, "kms.rotate.retire", { approver, kid });
      return res.json({ ok: true, retiredKid: kid });
    }

    if (stage === "drill") {
      const summary = await runRotationDrill();
      await appendAudit(actor, "kms.rotate.drill", { approver, summary });
      return res.json({ ok: true, summary });
    }

    return res.status(400).json({ error: "Unknown stage" });
  } catch (err: any) {
    const status = err?.status ?? 500;
    return res.status(status).json({ error: String(err?.message || err) });
  }
});
