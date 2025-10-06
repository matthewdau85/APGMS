import { Router } from "express";
import { listDlq } from "../ingest/store";
import { replayDlq } from "../recon/dlq";

const router = Router();

router.get("/dlq/list", (_req, res) => {
  res.json({ items: listDlq() });
});

router.post("/dlq/replay", (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const result = replayDlq(ids);
  res.json({ result });
});

export const reconRouter = router;
