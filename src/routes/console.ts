// src/routes/console.ts
import { Router } from "express";
import { consoleData } from "../data/console";

export const consoleRouter = Router();

consoleRouter.get("/console/dashboard", (_req, res) => {
  res.json(consoleData.dashboard);
});

consoleRouter.get("/console/bas", (_req, res) => {
  res.json(consoleData.bas);
});

consoleRouter.get("/console/settings", (_req, res) => {
  res.json(consoleData.settings);
});

consoleRouter.get("/console/audit", (_req, res) => {
  res.json(consoleData.audit);
});
