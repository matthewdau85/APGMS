import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { api } from "../../src/api";

export default async function appFactory() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan("tiny"));
  app.use("/api", api);
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  return app;
}
