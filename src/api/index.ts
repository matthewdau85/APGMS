import { Router } from "express";

import { idempotency } from "../middleware/idempotency";
import {
  closeAndIssue,
  payAto,
  paytoSweep,
  settlementWebhook,
  evidence,
} from "../routes/reconcile";
import { paymentsApi } from "./payments";

const apiRouter = Router();

const reconRouter = Router();
reconRouter.post("/close-issue", closeAndIssue);
reconRouter.post("/pay", idempotency(), payAto);

const paytoRouter = Router();
paytoRouter.post("/sweep", paytoSweep);

const settlementRouter = Router();
settlementRouter.post("/webhook", settlementWebhook);

const evidenceRouter = Router();
evidenceRouter.get("/", evidence);

const healthRouter = Router();
healthRouter.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

const debugRouter = Router();
debugRouter.get("/ping", (_req, res) => {
  res.json({ status: "debug" });
});

apiRouter.use("/payments", paymentsApi);
apiRouter.use("/recon", reconRouter);
apiRouter.use("/payto", paytoRouter);
apiRouter.use("/settlement", settlementRouter);
apiRouter.use("/evidence", evidenceRouter);
apiRouter.use("/health", healthRouter);
apiRouter.use("/debug", debugRouter);

apiRouter.post("/pay", idempotency(), payAto);
apiRouter.post("/close-issue", closeAndIssue);
apiRouter.post("/payto/sweep", paytoSweep);
apiRouter.post("/settlement/webhook", settlementWebhook);
apiRouter.get("/evidence", evidence);

apiRouter.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});

export default apiRouter;
export { apiRouter };
