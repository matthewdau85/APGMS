import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";

const pool = new Pool();

function envTrue(v?: string | null) {
  return !!v && /^(1|true|yes)$/i.test(v);
}

async function callSimRail(params: {
  abn: string;
  taxType: string;
  periodId: string;
  rail: "EFT" | "BPAY";
  reference: string;
  amountCents: number;
  idempotencyKey: string;
}) {
  const base = (process.env.SIM_RAIL_BASE_URL || "http://localhost:3000/sim/rail").replace(/\/$/, "");
  const url = `${base}/${params.rail.toLowerCase()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      amount_cents: params.amountCents,
      abn: params.abn,
      taxType: params.taxType,
      periodId: params.periodId,
      reference: params.reference,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Sim rail error ${res.status}`);
  }
  const data = await res.json();
  return {
    provider_ref: String(data.provider_ref || ""),
    paid_at: String(data.paid_at || new Date().toISOString()),
  };
}

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: "EFT" | "BPAY", reference: string) {
  const { rows } = await pool.query(
    "select * from remittance_destinations where abn= and rail= and reference=",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

/** Idempotent release with a stable transfer_uuid (simulate bank release) */
export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: "EFT" | "BPAY",
  reference: string,
  idempotencyKey?: string
) {
  const transfer_uuid = uuidv4();
  const idemKey = idempotencyKey || transfer_uuid;
  const useSim = envTrue(process.env.FEATURE_SIM_OUTBOUND);
  try {
    await pool.query("insert into idempotency_keys(key,last_status) values(,)", [idemKey, "INIT"]);
  } catch {
    if (useSim && idempotencyKey) {
      const existing = await pool.query(
        "select provider_ref, paid_at from sim_settlements where idem_key= and rail= limit 1",
        [idempotencyKey, rail]
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        return {
          transfer_uuid,
          bank_receipt_id: row.provider_ref,
          provider_ref: row.provider_ref,
          paid_at: new Date(row.paid_at).toISOString(),
          status: "DUPLICATE",
        };
      }
    }
    return { transfer_uuid, status: "DUPLICATE" };
  }

  let providerRef = "";
  let paidAt = new Date().toISOString();
  if (useSim) {
    const sim = await callSimRail({
      abn,
      taxType,
      periodId,
      rail,
      reference,
      amountCents,
      idempotencyKey: idemKey,
    });
    providerRef = sim.provider_ref;
    paidAt = sim.paid_at;
  }
  const bank_receipt_id = providerRef || "bank:" + transfer_uuid.slice(0, 12);

  const { rows } = await pool.query(
    "select balance_after_cents, hash_after from owa_ledger where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId]
  );
  const prevBal = rows[0]?.balance_after_cents ?? 0;
  const prevHash = rows[0]?.hash_after ?? "";
  const newBal = prevBal - amountCents;
  const hashAfter = sha256Hex(prevHash + bank_receipt_id + String(newBal));

  await pool.query(
    "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_id,prev_hash,hash_after) values (,,,,,,,,)",
    [abn, taxType, periodId, transfer_uuid, -amountCents, newBal, bank_receipt_id, prevHash, hashAfter]
  );
  await appendAudit("rails", "release", {
    abn,
    taxType,
    periodId,
    amountCents,
    rail,
    reference,
    bank_receipt_id,
    providerRef,
    paidAt,
  });
  await pool.query("update idempotency_keys set last_status= where key=", [idemKey, "DONE"]);
  return { transfer_uuid, bank_receipt_id, provider_ref: providerRef || null, paid_at: paidAt };
}
