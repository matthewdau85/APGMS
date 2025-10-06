import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db/pool";
import { fetchTaxTotals } from "../taxEngine/client";
import { computeLedgerProofs } from "../ledger/proofs";
import { canonicalJson } from "../utils/canonical";
import { sha256Hex } from "../crypto/merkle";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import nacl from "tweetnacl";

const DEFAULT_RPT_SECRET = "zt4Y+4kcx4Axd6e/a8NuXD0lVn8JIWQwHwJM0vlA2+vi6UIwf0gnqgKr+LKkGAqRTSCz8xms8DJNonp125yhJQ==";

const rptSecretBase64 = process.env.RPT_ED25519_SECRET_BASE64 || DEFAULT_RPT_SECRET;

function ensureRptSecret(): Uint8Array {
  if (!rptSecretBase64) {
    throw new Error("RPT_ED25519_SECRET_BASE64 missing");
  }
  const buf = Buffer.from(rptSecretBase64, "base64");
  if (buf.length !== 64) {
    throw new Error("RPT secret must be 64 byte ed25519 key");
  }
  return new Uint8Array(buf);
}

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }

  try {
    const result = await withTransaction(async (client) => {
      const periodQ = await client.query(
        `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE`,
        [abn, taxType, periodId]
      );
      if (!periodQ.rowCount) {
        throw new Error("PERIOD_NOT_FOUND");
      }
      const period = periodQ.rows[0];
      if (period.state === "OPEN") {
        await client.query(`UPDATE periods SET state='CLOSING' WHERE id=$1`, [period.id]);
        period.state = "CLOSING";
      }
      if (period.state !== "CLOSING") {
        throw new Error(`BAD_STATE:${period.state}`);
      }

      await client.query(`SELECT periods_sync_totals($1,$2,$3)`, [abn, taxType, periodId]);

      const totals = await fetchTaxTotals(client, abn, taxType, periodId);
      const proofs = await computeLedgerProofs(client, abn, taxType, periodId);

      const updated = await client.query(
        `UPDATE periods
            SET final_liability_cents=$1,
                rates_version=$2,
                merkle_root=$3,
                running_balance_hash=$4,
                state='CLOSING'
          WHERE id=$5
        RETURNING *`,
        [
          totals.liability_cents,
          totals.rates_version,
          proofs.merkle_root,
          proofs.running_balance_hash,
          period.id,
        ]
      );
      const refreshed = updated.rows[0];

      const nonce = randomUUID();
      const exp = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const payload = {
        abn,
        period_id: periodId,
        tax_type: taxType,
        liability_cents: Number(refreshed.final_liability_cents || 0),
        rates_version: refreshed.rates_version,
        merkle_root: refreshed.merkle_root,
        running_balance_hash: refreshed.running_balance_hash,
        nonce,
        exp,
      };
      const payloadC14n = canonicalJson(payload);
      const signature = signPayload(payloadC14n, ensureRptSecret());
      const payloadSha = sha256Hex(payloadC14n);

      const rptInsert = await client.query(
        `INSERT INTO rpt_tokens
          (abn,tax_type,period_id,payload,signature,status,payload_c14n,payload_sha256,expires_at,rates_version,nonce)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          abn,
          taxType,
          periodId,
          payload,
          signature,
          payloadC14n,
          payloadSha,
          exp,
          refreshed.rates_version,
          nonce,
        ]
      );

      await client.query(`UPDATE periods SET state='READY_RPT' WHERE id=$1`, [period.id]);

      return {
        rpt_id: rptInsert.rows[0].id,
        payload,
        payload_c14n: payloadC14n,
        payload_sha256: payloadSha,
        signature,
      };
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || String(err) });
  }
}

function signPayload(payloadC14n: string, secret: Uint8Array): string {
  const msg = new TextEncoder().encode(payloadC14n);
  const sig = nacl.sign.detached(msg, secret);
  return Buffer.from(sig).toString("base64url");
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  const pr = await pool.query(
    "select payload from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload as any;
  if (!payload?.reference || typeof payload?.amount_cents !== "number") {
    return res.status(400).json({ error: "RPT payload missing legacy fields" });
  }
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query(
      "update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    );
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req:any, res:any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req:any, res:any) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as any;
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  res.json(await buildEvidenceBundle(String(abn), String(taxType), String(periodId)));
}

export async function evidenceByPeriod(req: Request, res: Response) {
  const { abn, taxType } = req.query as any;
  const { periodId } = req.params as any;
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  res.json(await buildEvidenceBundle(String(abn), String(taxType), String(periodId)));
}
