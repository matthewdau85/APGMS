import { Client } from "pg";
import { randomUUID, createHash } from "node:crypto";
import nacl from "tweetnacl";

const defaultUrl =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(process.env.PGPASSWORD || "")}` +
    `@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "apgms"}`;

const DEMO_ABN = "53004085616";
const DEMO_TAX = "PAYGW";
const DEMO_PERIOD = "2024Q4";

function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((x) => canonicalize(x)).join(",")}]`;
  const entries = Object.entries(obj as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

async function ensureLedgerSeed(client: Client) {
  await client.query(
    `INSERT INTO owa_ledger (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents, created_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT DO NOTHING`,
    [DEMO_ABN, DEMO_TAX, DEMO_PERIOD, randomUUID(), 500_00, 500_00]
  );
}

async function ensurePeriod(client: Client) {
  await client.query(
    `INSERT INTO periods (abn, tax_type, period_id, state, accrued_cents, credited_to_owa_cents, final_liability_cents, thresholds)
     VALUES ($1,$2,$3,'READY_RPT',$4,$4,$4,$5)
     ON CONFLICT (abn, tax_type, period_id)
     DO UPDATE SET state='READY_RPT', credited_to_owa_cents=$4, final_liability_cents=$4, thresholds=$5`,
    [DEMO_ABN, DEMO_TAX, DEMO_PERIOD, 500_00, { epsilon_cents: 50, variance_ratio: 0.25 }]
  );
}

async function ensureDestination(client: Client) {
  await client.query(
    `INSERT INTO remittance_destinations (abn, label, rail, reference, account_bsb, account_number)
     VALUES ($1,$2,'EFT',$3,'123-456','987654')
     ON CONFLICT (abn, rail, reference)
     DO UPDATE SET label=$2`,
    [DEMO_ABN, "ATO Primary", "ATO-PRN-001"]
  );
}

async function seedRpt(client: Client) {
  const seed = new Uint8Array(32).fill(7);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const publicKeyBase64 = Buffer.from(keyPair.publicKey).toString("base64");
  if (!process.env.ED25519_PUBLIC_KEY_BASE64) {
    process.env.ED25519_PUBLIC_KEY_BASE64 = publicKeyBase64;
  }

  const payload = {
    entity_id: DEMO_ABN,
    period_id: DEMO_PERIOD,
    tax_type: DEMO_TAX,
    amount_cents: 500_00,
    merkle_root: "demo-merkle",
    running_balance_hash: "demo-running",
    anomaly_vector: {},
    thresholds: { epsilon_cents: 50, variance_ratio: 0.25 },
    rail_id: "EFT",
    reference: "ATO-PRN-001",
    expiry_ts: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    nonce: randomUUID(),
  };

  const payloadC14n = canonicalize(payload);
  const payloadSha = createHash("sha256").update(payloadC14n).digest("hex");
  const signature = Buffer.from(
    nacl.sign.detached(Buffer.from(payloadC14n), keyPair.secretKey)
  ).toString("base64");

  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='rpt_tokens'`
  );
  const columns = new Set(rows.map((r) => r.column_name));

  const data: Record<string, unknown> = {
    abn: DEMO_ABN,
    tax_type: DEMO_TAX,
    period_id: DEMO_PERIOD,
    status: "active",
  };

  if (columns.has("payload")) data.payload = payload;
  if (columns.has("payload_json")) data.payload_json = payload;
  if (columns.has("payload_c14n")) data.payload_c14n = payloadC14n;
  if (columns.has("payload_sha256")) data.payload_sha256 = payloadSha;
  if (columns.has("payload_sha256_hex")) data.payload_sha256_hex = payloadSha;
  if (columns.has("signature")) data.signature = signature;
  if (columns.has("sig_ed25519")) data.sig_ed25519 = Buffer.from(signature, "base64");
  if (columns.has("key_id")) data.key_id = "demo-ed25519";
  if (columns.has("kid")) data.kid = "demo-ed25519";
  if (columns.has("nonce")) data.nonce = payload.nonce;
  if (columns.has("expires_at")) data.expires_at = payload.expiry_ts;

  await client.query(
    "DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [DEMO_ABN, DEMO_TAX, DEMO_PERIOD]
  );

  const keys = Object.keys(data);
  const placeholders = keys.map((_, idx) => `$${idx + 1}`);
  const values = keys.map((k) => data[k]);
  const sql = `INSERT INTO rpt_tokens (${keys.join(",")}) VALUES (${placeholders.join(",")})`;
  await client.query(sql, values);
}

async function main() {
  const client = new Client({ connectionString: defaultUrl });
  await client.connect();

  try {
    await ensurePeriod(client);
    await ensureLedgerSeed(client);
    await ensureDestination(client);
    await seedRpt(client);
    console.log("Seeded demo data for", DEMO_ABN, DEMO_PERIOD);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Seeding failed", err);
  process.exit(1);
});
