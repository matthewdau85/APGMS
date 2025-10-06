import https from "https";
import fs from "fs";
import { URL } from "url";
import { createHash } from "crypto";
import { Pool } from "pg";

export interface SandboxPaymentRequest {
  periodId: string;
  amountCents: number;
  reference: string;
  bsb: string;
  account: string;
  narration?: string;
}

export interface SandboxPaymentResponse {
  settlementId: number;
  providerRef: string;
  paidAt: string;
  bankReceiptHash: string;
}

const pool = new Pool();

function loadFile(path?: string) {
  if (!path) return undefined;
  return fs.readFileSync(path);
}

const agent = new https.Agent({
  cert: loadFile(process.env.MTLS_CERT),
  key: loadFile(process.env.MTLS_KEY),
  ca: loadFile(process.env.MTLS_CA),
  rejectUnauthorized: true,
});

function ensureBsb(value: string) {
  if (!/^\d{6}$/.test(value)) {
    throw new Error("INVALID_BSB");
  }
}

function ensureAccount(value: string) {
  if (!/^\d{6,10}$/.test(value)) {
    throw new Error("INVALID_ACCOUNT");
  }
}

async function postJson(url: string, payload: unknown) {
  const target = new URL(url);
  const body = JSON.stringify(payload);

  const options: https.RequestOptions = {
    method: "POST",
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body).toString(),
    },
    agent,
  };

  return new Promise<any>((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode || 500) >= 400) {
          return reject(new Error(`EFT_SANDBOX_${res.statusCode}: ${text}`));
        }
        try {
          resolve(text ? JSON.parse(text) : {});
        } catch (err) {
          reject(new Error("EFT_SANDBOX_BAD_JSON"));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function submitSandboxPayment(request: SandboxPaymentRequest): Promise<SandboxPaymentResponse> {
  ensureBsb(request.bsb);
  ensureAccount(request.account);

  const baseUrl = process.env.EFT_SANDBOX_URL;
  if (!baseUrl) {
    throw new Error("EFT_SANDBOX_URL_NOT_SET");
  }

  const response = await postJson(baseUrl, {
    amount_cents: request.amountCents,
    destination: { bsb: request.bsb, account: request.account },
    reference: request.reference,
    narration: request.narration ?? "ATO EFT release",
  });

  const providerRef: string =
    response?.provider_ref || response?.receipt_id || response?.receipt?.id || "";
  if (!providerRef) {
    throw new Error("EFT_SANDBOX_NO_RECEIPT");
  }

  const paidAt = new Date(response?.paid_at || response?.receipt?.paid_at || Date.now()).toISOString();
  const bankReceiptHash = createHash("sha256").update(providerRef).digest("hex");

  const upsert = `
    INSERT INTO settlements (period_id, rail, provider_ref, amount_cents, paid_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (provider_ref)
    DO UPDATE SET amount_cents = EXCLUDED.amount_cents, paid_at = EXCLUDED.paid_at
    RETURNING id
  `;
  const { rows } = await pool.query<{ id: number }>(upsert, [
    request.periodId,
    "EFT",
    providerRef,
    request.amountCents,
    paidAt,
  ]);

  return {
    settlementId: rows[0]?.id ?? 0,
    providerRef,
    paidAt,
    bankReceiptHash,
  };
}
