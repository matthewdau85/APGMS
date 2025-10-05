import { Router } from "express";
import { paymentsApi } from "./payments";
import { evidence } from "../routes/reconcile";

export const api = Router();

// Payments endpoints should be mounted first to avoid catch-alls shadowing them.
api.use("/payments", paymentsApi);

// Evidence bundle endpoint.
api.get("/evidence", evidence);
