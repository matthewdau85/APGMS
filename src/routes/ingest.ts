import { Router } from "express";
import { verifyHmac } from "../ingest/hmac";
import { addPayrollEvent, addPosEvent } from "../ingest/store";
import { parsePosEvent, parseStpEvent } from "../ingest/schemas";
import { processRecon } from "../recon/pipeline";

const router = Router();

function getRawBody(req: any): string {
  if (typeof req.rawBody === "string") return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString("utf8");
  return JSON.stringify(req.body ?? {});
}

router.post("/stp", (req, res) => {
  const signature = req.get("x-apg-signature");
  const secret = process.env.STP_WEBHOOK_SECRET;
  const rawBody = getRawBody(req);
  if (!verifyHmac(signature, rawBody, secret)) {
    return res.status(401).json({ error: "INVALID_SIGNATURE" });
  }

  const parsed = parseStpEvent(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", details: parsed.errors });
  }

  const event = addPayrollEvent(parsed.data);
  try {
    const result = processRecon(event.period);
    return res.status(202).json({ ok: true, recon: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    return res.status(202).json({ ok: false, error: message });
  }
});

router.post("/pos", (req, res) => {
  const signature = req.get("x-apg-signature");
  const secret = process.env.POS_WEBHOOK_SECRET;
  const rawBody = getRawBody(req);
  if (!verifyHmac(signature, rawBody, secret)) {
    return res.status(401).json({ error: "INVALID_SIGNATURE" });
  }

  const parsed = parsePosEvent(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", details: parsed.errors });
  }

  const event = addPosEvent(parsed.data);
  try {
    const period = new Date(event.dt);
    const periodId = Number.isNaN(period.getTime())
      ? event.dt.slice(0, 7)
      : `${period.getUTCFullYear()}-${String(period.getUTCMonth() + 1).padStart(2, "0")}`;
    const result = processRecon(periodId);
    return res.status(202).json({ ok: true, recon: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    return res.status(202).json({ ok: false, error: message });
  }
});

export const ingestRouter = router;
