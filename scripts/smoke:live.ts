import { existsSync, readFileSync } from "node:fs";
import { runSmoke } from "./smoke:sim";

async function main() {
  const baseUrl = process.env.SMOKE_LIVE_BASE_URL || process.env.LIVE_BASE_URL;
  if (!baseUrl) {
    console.log("[smoke-live] SMOKE_LIVE_BASE_URL not set; skipping live smoke");
    return;
  }

  const abn = process.env.SMOKE_LIVE_ABN;
  const periodId = process.env.SMOKE_LIVE_PERIOD_ID;
  const taxType = process.env.SMOKE_LIVE_TAX_TYPE || "GST";
  if (!abn || !periodId) {
    console.error("[smoke-live] SMOKE_LIVE_ABN and SMOKE_LIVE_PERIOD_ID must be set for live smoke");
    process.exitCode = 1;
    return;
  }

  let dispatcher: any;
  const certPath = process.env.SMOKE_LIVE_CLIENT_CERT;
  const keyPath = process.env.SMOKE_LIVE_CLIENT_KEY;
  const caPath = process.env.SMOKE_LIVE_CA;
  const load = (source?: string) => {
    if (!source) return undefined;
    if (source.startsWith("base64:")) return Buffer.from(source.slice(7), "base64");
    if (source.includes("-----BEGIN")) return Buffer.from(source);
    if (existsSync(source)) return readFileSync(source);
    return Buffer.from(source);
  };

  if (certPath && keyPath) {
    const { Agent } = await import("undici");
    dispatcher = new Agent({
      connect: {
        cert: load(certPath),
        key: load(keyPath),
        ca: caPath ? load(caPath) : undefined,
        rejectUnauthorized: process.env.SMOKE_LIVE_REJECT_TLS === "false" ? false : true,
      },
    });
  }

  try {
    await runSmoke({ baseUrl, abn, taxType, periodId, dispatcher });
    console.log("[smoke-live] Smoke test completed against live sandbox");
  } catch (err) {
    console.error("[smoke-live] Smoke test failed", err);
    process.exitCode = 1;
  } finally {
    if (dispatcher?.close) {
      await dispatcher.close();
    }
  }
}

main();
