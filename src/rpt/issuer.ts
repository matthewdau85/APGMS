import { Pool } from "pg";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";

const SECRET_ENV_KEY = "RPT_ED25519_SECRET_BASE64";
const LOCAL_ENV_FIXTURE = ".env.rpt.fixture";

let cachedSecret: Uint8Array | null = null;
let pool: Pool | null = null;
let poolFactory: () => Pool = () => new Pool();
let sign = signRpt;
let exceedsFn = exceeds;

function readFixtureSecret(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const envPath = path.resolve(process.cwd(), LOCAL_ENV_FIXTURE);
  if (!fs.existsSync(envPath)) return undefined;
  const buffer = fs.readFileSync(envPath);
  const parsed = dotenv.parse(buffer);
  return parsed[SECRET_ENV_KEY]?.trim();
}

function getSecretKey(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  const base64 = (process.env[SECRET_ENV_KEY] ?? readFixtureSecret() ?? "").trim();
  if (!base64) {
    throw new Error(`CONFIG: ${SECRET_ENV_KEY} is required and must be a base64 encoded Ed25519 secret key`);
  }

  const decoded = Buffer.from(base64, "base64");
  if (decoded.length !== 64) {
    throw new Error(`CONFIG: ${SECRET_ENV_KEY} must decode to a 64-byte Ed25519 secret key`);
  }

  cachedSecret = new Uint8Array(decoded);
  return cachedSecret;
}

function getPool(): Pool {
  if (!pool) pool = poolFactory();
  return pool;
}

export function __resetIssuerSecretForTest() {
  cachedSecret = null;
}

export const __testHooks = {
  setPoolFactory(factory: () => Pool) {
    poolFactory = factory;
    pool = null;
  },
  setSignFn(fn: typeof signRpt) {
    sign = fn;
  },
  setExceedsFn(fn: typeof exceeds) {
    exceedsFn = fn;
  },
  reset() {
    poolFactory = () => new Pool();
    pool = null;
    sign = signRpt;
    exceedsFn = exceeds;
    __resetIssuerSecretForTest();
  }
};

export async function issueRPT(abn: string, taxType: "PAYGW"|"GST", periodId: string, thresholds: Record<string, number>) {
  const secretKey = getSecretKey();

  const p = await getPool().query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const v = row.anomaly_vector || {};
  if (exceedsFn(v, thresholds)) {
    await getPool().query("update periods set state='BLOCKED_ANOMALY' where id=", [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await getPool().query("update periods set state='BLOCKED_DISCREPANCY' where id=", [row.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const payload: RptPayload = {
    entity_id: row.abn, period_id: row.period_id, tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root, running_balance_hash: row.running_balance_hash,
    anomaly_vector: v, thresholds, rail_id: "EFT", reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15*60*1000).toISOString(), nonce: crypto.randomUUID()
  };
  const signature = sign(payload, secretKey);
  await getPool().query("insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values (,,,,)",
    [abn, taxType, periodId, payload, signature]);
  await getPool().query("update periods set state='READY_RPT' where id=", [row.id]);
  return { payload, signature };
}
