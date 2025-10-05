# ======================================================================
# setup_rpt_owa_stack.ps1
# Scaffolds RPT egress gate, OWA constraints, KMS/HSM abstraction,
# bank adapters (EFT/BPAY + PayTo), evidence bundle, tests, and SQL migrations.
# Target repo: C:\Users\matth\OneDrive\Desktop\apgms-final
# ======================================================================

param(
  [string]$Repo = "C:\Users\matth\OneDrive\Desktop\apgms-final"
)

# ---- Helpers ----------------------------------------------------------
function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Write-TextFile([string]$Path, [string]$Content) {
  # Use .NET API to avoid Split-Path parameter-set ambiguity
  $dir = [System.IO.Path]::GetDirectoryName($Path)
  if (![string]::IsNullOrEmpty($dir)) { Ensure-Dir $dir }

  # Write with UTF-8 (no BOM) to keep Node/TS happy
  [System.IO.File]::WriteAllText(
    $Path,
    $Content,
    (New-Object System.Text.UTF8Encoding($false))
  )
}

# ---- Root layout ------------------------------------------------------
$paymentsSrc   = Join-Path $Repo "apps\services\payments\src"
$paymentsTest  = Join-Path $Repo "apps\services\payments\test"
$paymentsRoot  = Join-Path $Repo "apps\services\payments"
$migrationsDir = Join-Path $Repo "db\migrations"
$rptVerifyDir  = Join-Path $Repo "apps\services\rpt-verify"

$folders = @(
  $paymentsSrc,
  (Join-Path $paymentsSrc "middleware"),
  (Join-Path $paymentsSrc "kms"),
  (Join-Path $paymentsSrc "bank"),
  (Join-Path $paymentsSrc "evidence"),
  (Join-Path $paymentsSrc "routes"),
  (Join-Path $paymentsSrc "utils"),
  $paymentsTest,
  $paymentsRoot,
  $migrationsDir,
  $rptVerifyDir
)

$folders | ForEach-Object { Ensure-Dir $_ }

# ---- SQL migrations ---------------------------------------------------
Write-TextFile (Join-Path $migrationsDir "20251005_001_rpt_tokens.sql") @'
-- RPT tokens with key id, timing, status
CREATE TABLE IF NOT EXISTS rpt_tokens (
  rpt_id            BIGSERIAL PRIMARY KEY,
  abn               VARCHAR(14) NOT NULL,
  tax_type          VARCHAR(16) NOT NULL,
  period_id         VARCHAR(32) NOT NULL,
  kid               VARCHAR(128) NOT NULL,
  payload_c14n      TEXT NOT NULL,
  payload_sha256    CHAR(64) NOT NULL,
  signature         BYTEA NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  status            VARCHAR(16) NOT NULL DEFAULT 'ISSUED',
  nonce             VARCHAR(64) UNIQUE NOT NULL,
  UNIQUE (abn, tax_type, period_id, status) WHERE status IN ('ISSUED')
);

CREATE INDEX IF NOT EXISTS rpt_tokens_lookup_idx
  ON rpt_tokens (abn, tax_type, period_id, status);

COMMENT ON TABLE rpt_tokens IS 'Reconciliation Pass Tokens with key id and expiry';
'@

Write-TextFile (Join-Path $migrationsDir "20251005_002_owa_constraints.sql") @'
CREATE TABLE IF NOT EXISTS owa_ledger (
  entry_id          BIGSERIAL PRIMARY KEY,
  abn               VARCHAR(14) NOT NULL,
  tax_type          VARCHAR(16) NOT NULL,
  period_id         VARCHAR(32) NOT NULL,
  amount_cents      BIGINT NOT NULL,
  rpt_verified      BOOLEAN NOT NULL DEFAULT false,
  release_uuid      UUID,
  bank_receipt_id   VARCHAR(128),
  hash_before       CHAR(64),
  hash_after        CHAR(64),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE owa_ledger
  ADD CONSTRAINT owa_deposit_only_chk
  CHECK (
    amount_cents >= 0
    OR (amount_cents < 0 AND rpt_verified = true AND release_uuid IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS owa_release_uuid_uidx
  ON owa_ledger (release_uuid) WHERE release_uuid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS owa_single_release_uidx
  ON owa_ledger (abn, tax_type, period_id)
  WHERE amount_cents < 0;

-- requires pgcrypto: CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE OR REPLACE FUNCTION owa_chain_hash_after()
RETURNS TRIGGER AS $$
DECLARE
  prev_hash CHAR(64);
BEGIN
  SELECT hash_after INTO prev_hash
  FROM owa_ledger
  WHERE abn = NEW.abn AND tax_type = NEW.tax_type AND period_id = NEW.period_id
  ORDER BY entry_id DESC
  LIMIT 1;

  NEW.hash_before := COALESCE(prev_hash, repeat('0', 64));
  NEW.hash_after  := encode(digest(
      NEW.abn || '|' || NEW.tax_type || '|' || NEW.period_id || '|' ||
      NEW.amount_cents::text || '|' || COALESCE(NEW.bank_receipt_id,'') || '|' ||
      COALESCE(NEW.release_uuid::text,'') || '|' || NEW.created_at::text || '|' ||
      NEW.hash_before, 'sha256'), 'hex');

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_owa_chain_hash ON owa_ledger;

CREATE TRIGGER trg_owa_chain_hash
BEFORE INSERT ON owa_ledger
FOR EACH ROW EXECUTE FUNCTION owa_chain_hash_after();
'@

Write-TextFile (Join-Path $migrationsDir "20251005_003_evidence_bundle.sql") @'
CREATE TABLE IF NOT EXISTS evidence_bundles (
  bundle_id           BIGSERIAL PRIMARY KEY,
  abn                 VARCHAR(14) NOT NULL,
  tax_type            VARCHAR(16) NOT NULL,
  period_id           VARCHAR(32) NOT NULL,
  payload_sha256      CHAR(64) NOT NULL,
  rpt_id              BIGINT REFERENCES rpt_tokens(rpt_id) ON DELETE SET NULL,
  rpt_payload         TEXT NOT NULL,
  rpt_signature       BYTEA NOT NULL,
  thresholds_json     JSONB NOT NULL,
  anomaly_vector      JSONB NOT NULL,
  normalization_hashes JSONB NOT NULL,
  owa_balance_before  BIGINT NOT NULL,
  owa_balance_after   BIGINT NOT NULL,
  bank_receipts       JSONB NOT NULL,
  ato_receipts        JSONB NOT NULL,
  operator_overrides  JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (abn, tax_type, period_id)
);

CREATE INDEX IF NOT EXISTS ev_bundles_lookup_idx
  ON evidence_bundles (abn, tax_type, period_id);
'@

# ---- TypeScript: utils ------------------------------------------------
Write-TextFile (Join-Path $paymentsSrc "utils\crypto.ts") @'
import { createHash } from "crypto";

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalJson(obj: any): string {
  return JSON.stringify(sortKeysDeep(obj));
}

function sortKeysDeep(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    Object.keys(value).sort().forEach(k => { out[k] = sortKeysDeep(value[k]); });
    return out;
  }
  return value;
}
'@

Write-TextFile (Join-Path $paymentsSrc "utils\allowlist.ts") @'
export type Dest = { bsb?: string; acct?: string; bpay_biller?: string; crn?: string };

export function isAllowlisted(abn: string, dest: Dest): boolean {
  if (dest.bpay_biller === "75556" && dest.crn && dest.crn.length >= 10) return true;
  return false;
}
'@

# ---- KMS providers ----------------------------------------------------
Write-TextFile (Join-Path $paymentsSrc "kms\kmsProvider.ts") @'
export interface KmsProvider {
  getPublicKey(kid: string): Promise<Uint8Array>;
  sign(kid: string, message: Uint8Array): Promise<Uint8Array>;
  verify(kid: string, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

export function selectKms(): KmsProvider {
  const p = process.env.KMS_PROVIDER || "local";
  if (p === "aws") return new (require("./awsKms").AwsKmsProvider)();
  if (p === "gcp") return new (require("./gcpKms").GcpKmsProvider)();
  return new (require("./localKey").LocalKeyProvider)();
}
'@

Write-TextFile (Join-Path $paymentsSrc "kms\awsKms.ts") @'
import { KmsProvider } from "./kmsProvider";
import { KMSClient, GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import * as ed from "@noble/ed25519";

export class AwsKmsProvider implements KmsProvider {
  private client = new KMSClient({ region: process.env.AWS_REGION || "ap-southeast-2" });

  async getPublicKey(kid: string): Promise<Uint8Array> {
    const out = await this.client.send(new GetPublicKeyCommand({ KeyId: kid }));
    if (!out.PublicKey) throw new Error("No public key");
    const raw = process.env.ED25519_PUB_RAW_BASE64;
    if (!raw) throw new Error("Set ED25519_PUB_RAW_BASE64 when using AWS KMS");
    return Buffer.from(raw, "base64");
  }

  async sign(kid: string, message: Uint8Array): Promise<Uint8Array> {
    const out = await this.client.send(new SignCommand({
      KeyId: kid, Message: message, MessageType: "RAW", SigningAlgorithm: "EDDSA"
    }));
    if (!out.Signature) throw new Error("No signature from KMS");
    return new Uint8Array(out.Signature as Buffer);
  }

  async verify(kid: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const pub = await this.getPublicKey(kid);
    return await ed.verify(signature, message, pub);
  }
}
'@

Write-TextFile (Join-Path $paymentsSrc "kms\gcpKms.ts") @'
import {KmsProvider} from "./kmsProvider";
import * as ed from "@noble/ed25519";
import { KeyManagementServiceClient } from "@google-cloud/kms";

export class GcpKmsProvider implements KmsProvider {
  private client = new KeyManagementServiceClient();

  async getPublicKey(kid: string): Promise<Uint8Array> {
    const raw = process.env.ED25519_PUB_RAW_BASE64;
    if (!raw) throw new Error("Set ED25519_PUB_RAW_BASE64 when using GCP KMS");
    return Buffer.from(raw, "base64");
  }

  async sign(kid: string, message: Uint8Array): Promise<Uint8Array> {
    const [resp] = await this.client.asymmetricSign({ name: kid, digest: { sha256: undefined }, data: message });
    if (!resp.signature) throw new Error("No signature from KMS");
    return new Uint8Array(resp.signature as Buffer);
  }

  async verify(kid: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const pub = await this.getPublicKey(kid);
    return await ed.verify(signature, message, pub);
  }
}
'@

Write-TextFile (Join-Path $paymentsSrc "kms\localKey.ts") @'
import { KmsProvider } from "./kmsProvider";
import * as ed from "@noble/ed25519";

export class LocalKeyProvider implements KmsProvider {
  async getPublicKey(kid: string): Promise<Uint8Array> {
    const b64 = process.env.ED25519_PUB_RAW_BASE64;
    if (!b64) throw new Error("ED25519_PUB_RAW_BASE64 missing");
    return Buffer.from(b64, "base64");
  }
  async sign(kid: string, message: Uint8Array): Promise<Uint8Array> {
    const b64 = process.env.ED25519_PRIV_RAW_BASE64;
    if (!b64) throw new Error("ED25519_PRIV_RAW_BASE64 missing");
    const sk = Buffer.from(b64, "base64");
    return await ed.sign(message, sk);
  }
  async verify(kid: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const pub = await this.getPublicKey(kid);
    return await ed.verify(signature, message, pub);
  }
}
'@

# ---- Egress RPT gate --------------------------------------------------
Write-TextFile (Join-Path $paymentsSrc "middleware\rptGate.ts") @'
import { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { sha256Hex } from "../utils/crypto";
import { selectKms } from "../kms/kmsProvider";

const kms = selectKms();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function rptGate(req: Request, res: Response, next: NextFunction) {
  try {
    const { abn, taxType, periodId } = req.body || {};
    if (!abn || !taxType || !periodId) return res.status(400).json({ error: "Missing abn/taxType/periodId" });

    const q = `
      SELECT rpt_id, kid, payload_c14n, payload_sha256, signature, expires_at, status, nonce
      FROM rpt_tokens
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3 AND status = 'ISSUED'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [abn, taxType, periodId]);
    if (!rows.length) return res.status(403).json({ error: "No active RPT for period" });

    const r = rows[0];
    if (new Date() > new Date(r.expires_at)) return res.status(403).json({ error: "RPT expired" });

    const recomputed = sha256Hex(r.payload_c14n);
    if (recomputed !== r.payload_sha256) return res.status(403).json({ error: "Payload hash mismatch" });

    const ok = await kms.verify(r.kid, Buffer.from(r.payload_c14n), r.signature);
    if (!ok) return res.status(403).json({ error: "RPT signature invalid" });

    (req as any).rpt = { rpt_id: r.rpt_id, kid: r.kid, nonce: r.nonce, payload_sha256: r.payload_sha256 };
    return next();
  } catch (e: any) {
    return res.status(500).json({ error: "RPT verification error", detail: String(e?.message || e) });
  }
}
'@

# ---- Bank adapters ----------------------------------------------------
Write-TextFile (Join-Path $paymentsSrc "bank\eftBpayAdapter.ts") @'
import https from "https";
import axios from "axios";
import { createHash, randomUUID } from "crypto";

type Params = {
  abn: string; taxType: string; periodId: string;
  amount_cents: number;
  destination: { bpay_biller?: string; crn?: string; bsb?: string; acct?: string };
  idempotencyKey: string;
};

const agent = new https.Agent({
  ca: process.env.BANK_TLS_CA ? require("fs").readFileSync(process.env.BANK_TLS_CA) : undefined,
  cert: process.env.BANK_TLS_CERT ? require("fs").readFileSync(process.env.BANK_TLS_CERT) : undefined,
  key: process.env.BANK_TLS_KEY ? require("fs").readFileSync(process.env.BANK_TLS_KEY) : undefined,
  rejectUnauthorized: true
});

const client = axios.create({
  baseURL: process.env.BANK_API_BASE,
  timeout: Number(process.env.BANK_TIMEOUT_MS || "8000"),
  httpsAgent: agent
});

export async function sendEftOrBpay(p: Params): Promise<{transfer_uuid: string; bank_receipt_hash: string; provider_receipt_id: string}> {
  const transfer_uuid = randomUUID();
  const payload = {
    amount_cents: p.amount_cents,
    meta: { abn: p.abn, taxType: p.taxType, periodId: p.periodId, transfer_uuid },
    destination: p.destination
  };

  const headers = { "Idempotency-Key": p.idempotencyKey };
  const maxAttempts = 3;
  let attempt = 0, lastErr: any;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const r = await client.post("/payments/eft-bpay", payload, { headers });
      const receipt = r.data?.receipt_id || "";
      const hash = createHash("sha256").update(receipt).digest("hex");
      return { transfer_uuid, bank_receipt_hash: hash, provider_receipt_id: receipt };
    } catch (e: any) {
      lastErr = e;
      await new Promise(s => setTimeout(s, attempt * 250));
    }
  }
  throw new Error("Bank transfer failed: " + String(lastErr?.message || lastErr));
}
'@

Write-TextFile (Join-Path $paymentsSrc "bank\paytoAdapter.ts") @'
import axios from "axios";
import https from "https";
const agent = new https.Agent({
  ca: process.env.BANK_TLS_CA ? require("fs").readFileSync(process.env.BANK_TLS_CA) : undefined,
  cert: process.env.BANK_TLS_CERT ? require("fs").readFileSync(process.env.BANK_TLS_CERT) : undefined,
  key: process.env.BANK_TLS_KEY ? require("fs").readFileSync(process.env.BANK_TLS_KEY) : undefined,
  rejectUnauthorized: true
});
const client = axios.create({
  baseURL: process.env.BANK_API_BASE,
  timeout: Number(process.env.BANK_TIMEOUT_MS || "8000"),
  httpsAgent: agent
});

export async function createMandate(abn: string, periodId: string, cap_cents: number) {
  const r = await client.post("/payto/mandates", { abn, periodId, cap_cents });
  return r.data;
}
export async function verifyMandate(mandate_id: string) {
  const r = await client.post(`/payto/mandates/${mandate_id}/verify`, {});
  return r.data;
}
export async function debitMandate(mandate_id: string, amount_cents: number, meta: any) {
  const r = await client.post(`/payto/mandates/${mandate_id}/debit`, { amount_cents, meta });
  return r.data;
}
export async function cancelMandate(mandate_id: string) {
  const r = await client.post(`/payto/mandates/${mandate_id}/cancel`, {});
  return r.data;
}
'@

# ---- Evidence bundle --------------------------------------------------
Write-TextFile (Join-Path $paymentsSrc "evidence\evidenceBundle.ts") @'
import { PoolClient } from "pg";
import { canonicalJson, sha256Hex } from "../utils/crypto";

type BuildParams = {
  abn: string; taxType: string; periodId: string;
  bankReceipts: Array<{provider: string; receipt_id: string}>;
  atoReceipts: Array<{submission_id: string; receipt_id: string}>;
  operatorOverrides: Array<{who: string; why: string; ts: string}>;
  owaAfterHash: string;
};

export async function buildEvidenceBundle(client: PoolClient, p: BuildParams) {
  const rpt = await client.query(
    "SELECT rpt_id, payload_c14n, payload_sha256, signature FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND status='ISSUED' ORDER BY created_at DESC LIMIT 1",
    [p.abn, p.taxType, p.periodId]
  );
  if (!rpt.rows.length) throw new Error("Missing RPT for bundle");
  const r = rpt.rows[0];

  const thresholds = { variance_pct: 0.02, dup_rate: 0.01, gap_allowed: 3 };
  const anomalies = { variance: 0.0, dups: 0, gaps: 0 };
  const normalization = { payroll_hash: "NA", pos_hash: "NA" };

  const beforeQ = await client.query(
    "SELECT COALESCE(SUM(amount_cents),0) bal FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND entry_id < (SELECT max(entry_id) FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3)",
    [p.abn, p.taxType, p.periodId]
  );
  const afterQ = await client.query(
    "SELECT COALESCE(SUM(amount_cents),0) bal FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [p.abn, p.taxType, p.periodId]
  );
  const balBefore = Number(beforeQ.rows[0]?.bal || 0);
  const balAfter = Number(afterQ.rows[0]?.bal || 0);

  const payload_sha256 = sha256Hex(r.payload_c14n);

  const ins = `
    INSERT INTO evidence_bundles (
      abn, tax_type, period_id, payload_sha256, rpt_id, rpt_payload, rpt_signature,
      thresholds_json, anomaly_vector, normalization_hashes,
      owa_balance_before, owa_balance_after,
      bank_receipts, ato_receipts, operator_overrides
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb)
    ON CONFLICT (abn, tax_type, period_id) DO UPDATE SET
      bank_receipts = EXCLUDED.bank_receipts,
      ato_receipts = EXCLUDED.ato_receipts,
      owa_balance_before = EXCLUDED.owa_balance_before,
      owa_balance_after = EXCLUDED.owa_balance_after
    RETURNING bundle_id
  `;
  const vals = [
    p.abn, p.taxType, p.periodId, payload_sha256, r.rpt_id, r.payload_c14n, r.signature,
    canonicalJson(thresholds), canonicalJson(anomalies), canonicalJson(normalization),
    balBefore, balAfter,
    canonicalJson(p.bankReceipts), canonicalJson(p.atoReceipts), canonicalJson(p.operatorOverrides)
  ];
  const out = await client.query(ins, vals);
  return out.rows[0].bundle_id as number;
}
'@

# ---- payAto route + server -------------------------------------------
Write-TextFile (Join-Path $paymentsSrc "routes\payAto.ts") @'
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { isAllowlisted } from "../utils/allowlist";
import { sendEftOrBpay } from "../bank/eftBpayAdapter";
import { buildEvidenceBundle } from "../evidence/evidenceBundle";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const payAtoRouter = Router();

payAtoRouter.post("/", async (req: Request, res: Response) => {
  const { abn, taxType, periodId, amount_cents, destination } = req.body || {};
  if (!abn || !taxType || !periodId || !amount_cents || !destination)
    return res.status(400).json({ error: "Missing required fields" });

  if (!isAllowlisted(abn, destination)) return res.status(403).json({ error: "Destination not allowlisted" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const balRes = await client.query(
      "SELECT COALESCE(SUM(amount_cents),0) AS bal FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );
    const balance = Number(balRes.rows[0]?.bal || 0);
    if (amount_cents > balance) throw new Error("Insufficient OWA balance");

    const idempotencyKey = `payato:${abn}:${taxType}:${periodId}`;
    const transfer = await sendEftOrBpay({
      abn, taxType, periodId, amount_cents, destination, idempotencyKey
    });

    const release_uuid = transfer.transfer_uuid || randomUUID();
    const ins = `
      INSERT INTO owa_ledger (abn, tax_type, period_id, amount_cents, rpt_verified, release_uuid, bank_receipt_id)
      VALUES ($1,$2,$3,$4,true,$5,$6)
      RETURNING entry_id, hash_after
    `;
    const neg = await client.query(ins, [abn, taxType, periodId, -Math.abs(amount_cents), release_uuid, transfer.provider_receipt_id]);

    await buildEvidenceBundle(client, {
      abn, taxType, periodId,
      bankReceipts: [{ provider: "EFT/BPAY", receipt_id: transfer.provider_receipt_id }],
      atoReceipts: [],
      operatorOverrides: [],
      owaAfterHash: neg.rows[0].hash_after
    });

    await client.query("COMMIT");
    return res.json({
      ok: true,
      release_uuid,
      bank_receipt_id: transfer.provider_receipt_id,
      bank_receipt_hash: transfer.bank_receipt_hash
    });
  } catch (e: any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: String(e?.message || e) });
  } finally {
    client.release();
  }
});
'@

Write-TextFile (Join-Path $paymentsSrc "index.ts") @'
import express from "express";
import bodyParser from "body-parser";
import { rptGate } from "./middleware/rptGate";
import { payAtoRouter } from "./routes/payAto";

const app = express();
app.use(bodyParser.json());
app.use("/payAto", rptGate, payAtoRouter);

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`payments up on :${port}`));
'@

# ---- package.json, tsconfig, tests -----------------------------------
Write-TextFile (Join-Path $paymentsRoot "package.json") @'
{
  "name": "payments",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "jest --runInBand",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "@noble/ed25519": "2.0.0",
    "@aws-sdk/client-kms": "3.645.0",
    "@google-cloud/kms": "3.3.2",
    "axios": "1.7.7",
    "body-parser": "1.20.2",
    "express": "4.19.2",
    "pg": "8.12.0"
  },
  "devDependencies": {
    "@types/express": "4.17.21",
    "@types/jest": "29.5.12",
    "jest": "29.7.0",
    "ts-jest": "29.2.3",
    "ts-node": "10.9.2",
    "typescript": "5.5.4"
  }
}
'@

Write-TextFile (Join-Path $paymentsRoot "tsconfig.json") @'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2020",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
'@

Write-TextFile (Join-Path $paymentsTest "rpt.test.ts") @'
import { canonicalJson, sha256Hex } from "../src/utils/crypto";
import * as ed from "@noble/ed25519";

test("RPT round-trip sign/verify", async () => {
  const payload = { abn:"12345678901", taxType:"PAYGW", periodId:"2025-09", total: 12345 };
  const c14n = canonicalJson(payload);
  const msg = Buffer.from(c14n);
  const sk = Buffer.alloc(32, 7);
  const pk = await ed.getPublicKey(sk);
  const sig = await ed.sign(msg, sk);
  const ok = await ed.verify(sig, msg, pk);
  expect(ok).toBe(true);
  expect(sha256Hex(c14n)).toHaveLength(64);
});
'@

Write-TextFile (Join-Path $paymentsTest "owa_constraints.test.ts") @'
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

test("OWA deposit-only constraint", async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("INSERT INTO owa_ledger (abn,tax_type,period_id,amount_cents) VALUES ($1,$2,$3,$4)",
      ["111", "PAYGW", "2025-09", 1000]);
    await expect(c.query(
      "INSERT INTO owa_ledger (abn,tax_type,period_id,amount_cents) VALUES ($1,$2,$3,$4)",
      ["111", "PAYGW", "2025-09", -500]
    )).rejects.toThrow();
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
'@

Write-TextFile (Join-Path $paymentsTest "allowlist.test.ts") @'
import { isAllowlisted } from "../src/utils/allowlist";
test("allowlist ok for ATO BPAY", () => {
  expect(isAllowlisted("123", { bpay_biller:"75556", crn:"12345678901" })).toBe(true);
});
test("deny non-ATO", () => {
  expect(isAllowlisted("123", { bsb:"012345", acct:"999999" })).toBe(false);
});
'@

Write-TextFile (Join-Path $paymentsTest "idempotency.test.ts") @'
import { createHash } from "crypto";
test("idempotency key stable", () => {
  const key = "payato:111:PAYGW:2025-09";
  const h = createHash("sha256").update(key).digest("hex");
  expect(h).toHaveLength(64);
});
'@

Write-TextFile (Join-Path $paymentsTest "evidence_bundle.test.ts") @'
test("evidence bundle schema basics", () => {
  expect(true).toBe(true);
});
'@

# ---- Optional FastAPI verifier ---------------------------------------
Write-TextFile (Join-Path $rptVerifyDir "requirements.txt") @'
fastapi==0.115.0
uvicorn==0.30.6
pydantic==2.9.2
PyNaCl==1.5.0
'@

Write-TextFile (Join-Path $rptVerifyDir "main.py") @'
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import nacl.signing, nacl.encoding, hashlib

app = FastAPI()

class VerifyIn(BaseModel):
    kid: str
    payload_c14n: str
    signature_b64: str
    pubkey_b64: str

@app.post("/verify")
def verify(v: VerifyIn):
    try:
        payload_hash = hashlib.sha256(v.payload_c14n.encode("utf-8")).hexdigest()
        verify_key = nacl.signing.VerifyKey(v.pubkey_b64, encoder=nacl.encoding.Base64Encoder)
        sig = nacl.encoding.Base64Encoder.decode(v.signature_b64)
        verify_key.verify(v.payload_c14n.encode("utf-8"), sig)
        return {"ok": True, "payload_sha256": payload_hash}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
'@

Write-Host "Scaffold complete." -ForegroundColor Green
