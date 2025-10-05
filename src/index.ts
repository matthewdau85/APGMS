import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import { api } from "./api";
import { getPool } from "./db/pool";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.use("/api", api);

getPool()
  .query("select 1")
  .then(() => {
    const port = Number(process.env.PORT || 8080);
    app.listen(port, () => console.log(`[apgms] api up on :${port}`));
  })
  .catch((err) => {
    console.error("[apgms] failed to init db pool:", err);
    process.exit(1);
  });
