import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import crypto from "node:crypto";
import nacl from "tweetnacl";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL not set");
}

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const secret =
  process.env.RPT_ED25519_SECRET_BASE64 ??
  Buffer.from(nacl.sign.keyPair().secretKey).toString("base64");

const abn = process.env.SMOKE_ABN ?? "12345678901";
const taxType = process.env.SMOKE_TAX_TYPE ?? "GST";
const periodId = process.env.SMOKE_PERIOD_ID ?? "2025-10";

async function waitForHealth(url: string, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { headers: { "x-request-id": crypto.randomUUID() } });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await delay(500);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

function startService(
  name: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  healthUrl: string
) {
  const proc = spawn(pnpmCmd, args, {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  proc.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));

  let readyResolved = false;
  const ready = waitForHealth(healthUrl)
    .then(() => {
      readyResolved = true;
    })
    .catch((err) => {
      proc.kill("SIGTERM");
      throw err;
    });

  const exitPromise = new Promise<void>((resolve, reject) => {
    proc.on("exit", (code) => {
      if (!readyResolved) {
        reject(new Error(`${name} exited before becoming healthy (code ${code})`));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${name} exited with code ${code}`));
      }
    });
  });

  return {
    ready,
    async stop() {
      proc.kill("SIGTERM");
      const timeout = delay(5000).then(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      });
      await Promise.race([exitPromise, timeout]);
    },
  };
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function getJson(url: string) {
  const res = await fetch(url, {
    headers: { "x-request-id": crypto.randomUUID() },
  });
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const baseEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    RPT_ED25519_SECRET_BASE64: secret,
  };

  const paymentsEnv = {
    ...baseEnv,
    PORT: process.env.PAYMENTS_PORT ?? "3001",
  };

  const appEnv = {
    ...baseEnv,
    PORT: process.env.APP_PORT ?? "3000",
    PAYMENTS_BASE_URL: `http://127.0.0.1:${paymentsEnv.PORT}`,
  };

  const payments = startService(
    "payments",
    ["--filter", "payments", "dev"],
    paymentsEnv,
    `http://127.0.0.1:${paymentsEnv.PORT}/healthz`
  );
  await payments.ready;

  const app = startService(
    "app",
    ["dev"],
    appEnv,
    `http://127.0.0.1:${appEnv.PORT}/healthz`
  );
  await app.ready;

  try {
    const deposit = await postJson(`http://127.0.0.1:${appEnv.PORT}/api/payments/deposit`, {
      abn,
      taxType,
      periodId,
      amountCents: 15000,
    });
    console.log("[smoke] deposit", deposit);

    const close = await postJson(`http://127.0.0.1:${appEnv.PORT}/api/close-issue`, {
      abn,
      taxType,
      periodId,
    });
    console.log("[smoke] close-and-issue", close);

    const evidence = await getJson(
      `http://127.0.0.1:${appEnv.PORT}/api/evidence?abn=${encodeURIComponent(abn)}&taxType=${encodeURIComponent(
        taxType
      )}&periodId=${encodeURIComponent(periodId)}`
    );
    console.log("[smoke] evidence keys", Object.keys(evidence));
  } finally {
    await app.stop().catch((err) => console.error("[smoke] app stop", err));
    await payments.stop().catch((err) => console.error("[smoke] payments stop", err));
  }
}

main().catch((err) => {
  console.error("[smoke] failed", err);
  process.exitCode = 1;
});
