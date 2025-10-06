// apps/services/payments/src/index.ts
import "dotenv/config";
import "./loadEnv.js"; // ensures .env.local is loaded when running with tsx

import { createPaymentsApp } from "./app.js";
import { initTelemetry } from "./observability/otel.js";
import { pool } from "./db.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

initTelemetry();

const app = createPaymentsApp();

app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      msg: "payments service listening",
      port: PORT,
      database: pool.options?.connectionString ? "custom" : "default",
    })
  );
});
