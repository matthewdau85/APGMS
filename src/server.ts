import express from "express";
import dotenv from "dotenv";

import apiRouter from "./api";

dotenv.config();

const app = express();

app.use(express.json({ limit: "2mb" }));

app.use((req, _res, next) => {
  console.log(`[app] ${req.method} ${req.url}`);
  next();
});

app.use("/api", apiRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use((_req, res) => res.status(404).json({ error: "Not Found" }));

export default app;
export { app };
