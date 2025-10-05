import express from "express";

import { router as paymentsApi } from "./payments";

export function createApp() {
  const app = express();
  app.use("/api/payments", paymentsApi);
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8080);
  const app = createApp();
  app.listen(port, () => {
    console.log(`App on http://localhost:${port}`);
  });
}
