import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import {
  parseSettlementEnvelope,
  SettlementValidationError,
} from "../settlement/splitParser";
import { settlementEvents, getSettlementMetrics } from "../settlement/events";
import { Pool } from "pg";
const pool = new Pool();

export async function closeAndIssue(req:any, res:any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  // TODO: set state -> CLOSING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req:any, res:any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId]);
  if (pr.rowCount === 0) return res.status(400).json({error:"NO_RPT"});
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req:any, res:any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req:any, res:any) {
  const receivedAt = new Date().toISOString();
  const payload = req.body ?? {};
  const rawPayload = typeof payload === "object" ? payload : {};

  try {
    const parsed = await parseSettlementEnvelope(payload, {
      async hasSeen(fileId: string) {
        const { rowCount } = await pool.query(
          "select 1 from settlement_files where file_id = $1 and status = 'ACCEPTED'",
          [fileId]
        );
        return rowCount > 0;
      },
    });

    try {
      await pool.query(
        `insert into settlement_files
          (file_id, schema_version, generated_at, received_at, signer_key_id, signature_verified, hmac_key_id, hmac_verified,
           csv_sha256, row_count, status, raw_payload, verification_artifacts)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACCEPTED',$11,$12)`,
        [
          parsed.fileId,
          parsed.schemaVersion,
          parsed.generatedAt,
          receivedAt,
          parsed.signerKeyId,
          parsed.signatureValid,
          parsed.hmacKeyId,
          parsed.hmacValid,
          parsed.csvHash,
          parsed.rows.length,
          rawPayload,
          {
            canonical_message: parsed.canonicalMessage,
            timestamp_skew_minutes: parsed.timestampSkewMinutes,
          },
        ]
      );
    } catch (dbErr: any) {
      if (dbErr?.code !== "23505") {
        throw dbErr;
      }
    }

    settlementEvents.emit({
      type: "settlement.accepted",
      fileId: parsed.fileId,
      rowCount: parsed.rows.length,
      generatedAt: parsed.generatedAt,
      receivedAt,
      signerKeyId: parsed.signerKeyId,
      hmacKeyId: parsed.hmacKeyId,
    });

    // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
    return res.json({ status: "ACCEPTED", fileId: parsed.fileId, ingested: parsed.rows.length });
  } catch (err: any) {
    const code = err instanceof SettlementValidationError ? err.code : "UNKNOWN";
    const httpStatus = code === "REPLAYED_FILE" ? 409 : err instanceof SettlementValidationError ? 400 : 500;
    const errorDetail = err instanceof SettlementValidationError ? err.details ?? {} : { message: err?.message };

    await pool.query(
      `insert into settlement_files
        (file_id, received_at, status, error_code, error_detail, raw_payload)
       values ($1,$2,'REJECTED',$3,$4,$5)`,
      [rawPayload?.file_id ?? null, receivedAt, code, errorDetail, rawPayload]
    );

    settlementEvents.emit({
      type: "settlement.rejected",
      fileId: rawPayload?.file_id,
      receivedAt,
      errorCode: code,
    });

    return res.status(httpStatus).json({ error: code, detail: err?.message, metadata: errorDetail });
  }
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}

export async function listSettlementFiles(req:any, res:any) {
  const limitRaw = Number(req.query?.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 200) : 50;
  const { rows } = await pool.query(
    `select id, file_id, schema_version, generated_at, received_at, signer_key_id, signature_verified,
            hmac_key_id, hmac_verified, row_count, status, error_code
       from settlement_files
      order by received_at desc
      limit $1`,
    [limit]
  );
  res.json(rows);
}

export async function getSettlementFile(req:any, res:any) {
  const fileId = req.params?.fileId;
  if (!fileId) {
    return res.status(400).json({ error: "MISSING_FILE_ID" });
  }
  const { rows } = await pool.query(
    `select * from settlement_files where file_id = $1 order by received_at desc limit 1`,
    [fileId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  res.json(rows[0]);
}

export function settlementMetricsHandler(_req:any, res:any) {
  res.json(getSettlementMetrics());
}
