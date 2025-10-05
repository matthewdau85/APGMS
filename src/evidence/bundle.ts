import fs from "fs";
import path from "path";
import { Pool } from "pg";
const pool = new Pool();

const DEFAULT_RATES_PATH = path.resolve(process.cwd(), "apps/services/tax-engine/app/data/rates_versions.json");

function cloneVersion(raw: any) {
  const clone = JSON.parse(JSON.stringify(raw));
  if (!('effective_to' in clone) || clone.effective_to === undefined) {
    clone.effective_to = clone.effective_to ?? null;
  }
  return clone;
}

function resolveRatesVersion(taxType: string, periodId: string) {
  const dataPath = process.env.RATES_DATA_PATH || DEFAULT_RATES_PATH;
  try {
    const raw = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    const versions = (raw.versions ?? []).filter((v: any) => (v.tax_type || "").toUpperCase() === taxType.toUpperCase());
    if (versions.length === 0) return null;
    const target = new Date(`${periodId}-01T00:00:00Z`);
    versions.sort((a: any, b: any) => (a.effective_from > b.effective_from ? -1 : 1));
    for (const v of versions) {
      const effFrom = new Date(`${v.effective_from}T00:00:00Z`);
      const effTo = v.effective_to ? new Date(`${v.effective_to}T23:59:59Z`) : new Date("9999-12-31T23:59:59Z");
      if (target >= effFrom && target <= effTo) {
        return cloneVersion(v);
      }
    }
    const latest = versions[0];
    return cloneVersion(latest);
  } catch (err) {
    return null;
  }
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId])).rows[0];
  const rpt = (await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId])).rows[0];
  const deltas = (await pool.query("select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn= and tax_type= and period_id= order by id", [abn, taxType, periodId])).rows;
  const last = deltas[deltas.length-1];
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null }, // TODO: populate
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [],  // TODO: populate from recon diffs
    rates_version: resolveRatesVersion(taxType, periodId)
  };
  return bundle;
}
