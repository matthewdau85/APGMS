import "dotenv/config";
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";

const DEMO_ABN = process.env.SEED_ABN ?? "12345678901";
const DEMO_TAX = process.env.SEED_TAX_TYPE ?? "GST";
const DEMO_PERIOD = process.env.SEED_PERIOD ?? "2025-09";

const PAYMENTS_BASE =
  process.env.SMOKE_PAYMENTS_URL ||
  process.env.PAYMENTS_BASE_URL ||
  "http://localhost:3001";

const PORTAL_BASE =
  process.env.SMOKE_PORTAL_URL ||
  process.env.PORTAL_BASE_URL ||
  "http://localhost:3000";

const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(
    process.env.PGPASSWORD || "apgms_pw"
  )}@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${
    process.env.PGDATABASE || "apgms"
  }`;

const pool = new Pool({ connectionString });

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  const parse = () => {
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status} ${res.statusText}: ${text}`, res.status);
  }
  return parse();
}

async function postJson(url: string, body: unknown, headers?: Record<string, string>) {
  return fetchJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  });
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function ensureClosingState() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ledger = await client.query<{
      id: number;
      amount_cents: string;
      bank_receipt_hash: string | null;
      balance_after_cents: string | number;
    }>(
      `SELECT id, amount_cents, bank_receipt_hash, balance_after_cents
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id ASC`,
      [DEMO_ABN, DEMO_TAX, DEMO_PERIOD]
    );

    if (ledger.rowCount === 0) {
      throw new Error("No ledger rows found. Run npm run seed first.");
    }

    let prevHash = "";
    const leaves: string[] = [];

    for (const row of ledger.rows) {
      const receipt = row.bank_receipt_hash ?? `synthetic:${row.id}`;
      const balanceAfter = Number(row.balance_after_cents);
      const prev = prevHash;
      const hashAfter = sha256(`${prev}|${receipt}|${balanceAfter}`);
      leaves.push(sha256(`${receipt}:${row.amount_cents}`));
      await client.query(
        `UPDATE owa_ledger
            SET bank_receipt_hash = COALESCE(bank_receipt_hash,$2),
                prev_hash = $3,
                hash_after = $4
          WHERE id=$1`,
        [row.id, receipt, prev || null, hashAfter]
      );
      prevHash = hashAfter;
    }

    let merkle = leaves;
    if (merkle.length === 0) {
      merkle = [sha256("")];
    }
    while (merkle.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < merkle.length; i += 2) {
        const left = merkle[i];
        const right = merkle[i + 1] ?? left;
        next.push(sha256(left + right));
      }
      merkle = next;
    }
    const merkleRoot = merkle[0];
    const lastRow = ledger.rows[ledger.rows.length - 1];
    if (!lastRow) {
      throw new Error("Ledger query returned no rows");
    }
    const finalBalance = Number(lastRow.balance_after_cents);

    const anomalyVector = {
      variance_ratio: 0,
      dup_rate: 0,
      gap_minutes: 0,
      delta_vs_baseline: 0,
    };
    const thresholds = {
      epsilon_cents: 0,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2,
      rates_version: process.env.SEED_RATES_VERSION ?? "demo-2025-09",
    };

    await client.query(
      `UPDATE periods
         SET state='CLOSING',
             accrued_cents=$4,
             credited_to_owa_cents=$4,
             final_liability_cents=$4,
             merkle_root=$5,
             running_balance_hash=$6,
             anomaly_vector=$7::jsonb,
             thresholds=$8::jsonb
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [
        DEMO_ABN,
        DEMO_TAX,
        DEMO_PERIOD,
        finalBalance,
        merkleRoot,
        prevHash,
        JSON.stringify(anomalyVector),
        JSON.stringify(thresholds),
      ]
    );

    await client.query(
      `DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [DEMO_ABN, DEMO_TAX, DEMO_PERIOD]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function closeAndIssue() {
  const payload = {
    abn: DEMO_ABN,
    taxType: DEMO_TAX,
    periodId: DEMO_PERIOD,
    thresholds: {
      epsilon_cents: 0,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2,
      rates_version: process.env.SEED_RATES_VERSION ?? "demo-2025-09",
    },
  };

  const candidates = [
    `${PORTAL_BASE.replace(/\/$/, "")}/close-and-issue`,
    `${PORTAL_BASE.replace(/\/$/, "")}/api/close-issue`,
  ];

  let lastErr: unknown;
  for (const url of candidates) {
    try {
      return await postJson(url, payload);
    } catch (err) {
      lastErr = err;
      if (err instanceof HttpError && err.status === 404) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("No close-and-issue endpoint responded");
}

async function fetchEvidence() {
  const base = PORTAL_BASE.replace(/\/$/, "");
  const paths = [
    `${base}/evidence/${encodeURIComponent(DEMO_PERIOD)}.json?abn=${encodeURIComponent(
      DEMO_ABN
    )}&taxType=${encodeURIComponent(DEMO_TAX)}`,
    `${base}/api/evidence?abn=${encodeURIComponent(DEMO_ABN)}&taxType=${encodeURIComponent(
      DEMO_TAX
    )}&periodId=${encodeURIComponent(DEMO_PERIOD)}`,
  ];

  let lastErr: unknown;
  for (const url of paths) {
    try {
      return await fetchJson(url);
    } catch (err) {
      lastErr = err;
      if (err instanceof HttpError && err.status === 404) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Evidence endpoint unavailable");
}

function findRatesVersion(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.rates_version === "string" && obj.rates_version.length > 0) {
    return obj.rates_version;
  }
  for (const value of Object.values(obj)) {
    const nested = typeof value === "object" ? findRatesVersion(value) : null;
    if (nested) return nested;
  }
  return null;
}

async function main() {
  console.log(`[smoke] Depositing demo funds via ${PAYMENTS_BASE}/deposit`);
  const depositBody = {
    abn: DEMO_ABN,
    taxType: DEMO_TAX,
    periodId: DEMO_PERIOD,
    amountCents: Number(process.env.SMOKE_DEPOSIT_CENTS ?? 12_345),
  };

  await postJson(
    `${PAYMENTS_BASE.replace(/\/$/, "")}/deposit`,
    depositBody,
    { "Idempotency-Key": randomUUID() }
  );

  console.log("[smoke] Deposit complete. Synchronising period state...");
  await ensureClosingState();

  console.log("[smoke] Calling close-and-issue endpoint...");
  await closeAndIssue();

  console.log("[smoke] Fetching evidence bundle...");
  const evidence = await fetchEvidence();
  const merkleRoot = evidence?.period?.merkle_root ?? null;
  const ratesVersion = findRatesVersion(evidence);

  if (!merkleRoot) {
    throw new Error("Evidence response missing merkle_root");
  }
  if (!ratesVersion) {
    throw new Error("Evidence response missing rates_version");
  }

  console.log(JSON.stringify({ merkle_root: merkleRoot, rates_version: ratesVersion }, null, 2));
}

main()
  .catch((err) => {
    console.error("[smoke] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
