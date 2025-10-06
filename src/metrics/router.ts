import { Router } from "express";
import { getPoolMetrics } from "../../libs/db/pool";
import { getAdapterQueueMetrics } from "../queues/adapterQueue";

export const metricsRouter = Router();

metricsRouter.get("/db", (_req, res) => {
  res.json({ pools: getPoolMetrics() });
});

metricsRouter.get("/queues", (_req, res) => {
  res.json({ queues: getAdapterQueueMetrics() });
});

metricsRouter.get("/", (_req, res) => {
  res.json({ pools: getPoolMetrics(), queues: getAdapterQueueMetrics() });
});
