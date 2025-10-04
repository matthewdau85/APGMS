import express from "express";
import dotenv from "dotenv";
import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";

dotenv.config();
const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/pay", idempotency(), payAto);
app.post("/api/close-issue", closeAndIssue);
app.post("/api/payto/sweep", paytoSweep);
app.post("/api/settlement/webhook", settlementWebhook);
app.get("/api/evidence", evidence);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
