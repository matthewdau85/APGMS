import express, { type NextFunction, type Request, type Response } from "express";

import { router as paymentsRouter } from "../apps/express/api/payments";
import { describeProviderRegistry } from "@core/providers/registry";

export const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/debug/providers", (_req, res) => {
  res.json(describeProviderRegistry());
});

app.use("/api/payments", paymentsRouter);

app.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.path });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api] unhandled error", error);
  res.status(500).json({ error: "internal_error" });
});

export function startServer(port: number = Number(process.env.PORT ?? 8080)) {
  return app.listen(port, () => {
    console.log(`App on http://localhost:${port}`);
  });
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}
