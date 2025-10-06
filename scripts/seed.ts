import { Pool } from "pg";
import crypto from "crypto";
import { ensureSettlementSchema } from "../src/settlement/schema";

const pool = new Pool();

async function ensurePeriod(abn: string, taxType: string, periodId: string, liabilityCents: number, depositCents: number) {
  await pool.query(
    `insert into periods(abn,tax_type,period_id,state,accrued_cents,credited_to_owa_cents,final_liability_cents,thresholds)
     values($1,$2,$3,'READY_RPT',$4,$5,$6,$7)
     on conflict(abn,tax_type,period_id) do update set
       accrued_cents=excluded.accrued_cents,
       credited_to_owa_cents=excluded.credited_to_owa_cents,
       final_liability_cents=excluded.final_liability_cents,
       state='READY_RPT',
       thresholds=excluded.thresholds`,
    [
      abn,
      taxType,
      periodId,
      liabilityCents,
      depositCents,
      liabilityCents,
      { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01 },
    ]
  );
}

async function ensureDestination(abn: string, rail: "EFT" | "BPAY", reference: string) {
  await pool.query(
    `insert into remittance_destinations(abn,label,rail,reference,account_bsb,account_number)
     values($1,$2,$3,$4,$5,$6)
     on conflict(abn,rail,reference) do nothing`,
    [abn, `${rail} primary`, rail, reference, "123-456", "987654" + reference.slice(-2)]
  );
}

async function ensureLedger(abn: string, taxType: string, periodId: string, depositCents: number) {
  const existing = await pool.query(
    "select 1 from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 limit 1",
    [abn, taxType, periodId]
  );
  if (existing.rowCount > 0) return;
  const transferUuid = crypto.randomUUID();
  await pool.query(
    `insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,created_at)
     values($1,$2,$3,$4,$5,$6,now())`,
    [abn, taxType, periodId, transferUuid, depositCents, depositCents]
  );
}

async function ensureRpt(abn: string, taxType: string, periodId: string, liabilityCents: number, reference: string) {
  const existing = await pool.query(
    "select 1 from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  if (existing.rowCount > 0) return;
  const payload = {
    entity_id: abn,
    period_id: periodId,
    tax_type: taxType,
    amount_cents: liabilityCents,
    merkle_root: null,
    running_balance_hash: null,
    anomaly_vector: {},
    thresholds: { epsilon_cents: 50 },
    rail_id: "EFT",
    reference,
    expiry_ts: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID(),
  };
  await pool.query(
    `insert into rpt_tokens(abn,tax_type,period_id,payload,signature,status)
     values($1,$2,$3,$4,$5,'ISSUED')`,
    [abn, taxType, periodId, payload, "sim-signature"]
  );
}

async function main() {
  await ensureSettlementSchema();
  const abn = process.env.SEED_ABN || "12345678901";
  const taxType = process.env.SEED_TAX_TYPE || "GST";
  const periodId = process.env.SEED_PERIOD_ID || "2025-09";
  const depositCents = Number(process.env.SEED_DEPOSIT_CENTS || 200000);
  const liabilityCents = Number(process.env.SEED_LIABILITY_CENTS || 150000);
  const reference = process.env.SEED_REFERENCE || "PRN-123456";

  await ensurePeriod(abn, taxType, periodId, liabilityCents, depositCents);
  await ensureDestination(abn, "EFT", reference);
  await ensureLedger(abn, taxType, periodId, depositCents);
  await ensureRpt(abn, taxType, periodId, liabilityCents, reference);

  console.log(`Seeded period ${periodId} for ${abn} (${taxType})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
