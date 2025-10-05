import { Pool } from "pg";
import { registerNonceOnce } from "./antiReplay";
import { verifyJWS } from "./kms";
import { RptPayloadV01 } from "./types";

const pool = new Pool();

function ensurePayloadShape(payload: RptPayloadV01) {
  if (!payload.rpt_id) throw new Error("RPT_PAYLOAD_NO_ID");
  if (!payload.abn) throw new Error("RPT_PAYLOAD_NO_ABN");
  if (!payload.bas_period) throw new Error("RPT_PAYLOAD_NO_PERIOD");
  if (!payload.totals || typeof payload.totals !== "object") throw new Error("RPT_PAYLOAD_NO_TOTALS");
  if (typeof payload.totals.paygw_cents !== "number") throw new Error("RPT_PAYLOAD_TOTALS_PAYGW");
  if (typeof payload.totals.gst_cents !== "number") throw new Error("RPT_PAYLOAD_TOTALS_GST");
  if (typeof payload.anomaly_score !== "number") throw new Error("RPT_PAYLOAD_ANOMALY");
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number") throw new Error("RPT_PAYLOAD_TIMING");
  if (!payload.nonce) throw new Error("RPT_PAYLOAD_NONCE");
  if (!payload.kid) throw new Error("RPT_PAYLOAD_KID");
}

export interface VerifyOptions {
  expectedAbn?: string;
  expectedPeriod?: string;
  expectedTotals?: { paygw_cents?: number; gst_cents?: number };
}

export async function verifyRptToken(jws: string, options: VerifyOptions = {}): Promise<RptPayloadV01> {
  const payload = await verifyJWS(jws);
  ensurePayloadShape(payload);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) throw new Error("RPT_EXPIRED");
  if (payload.iat > now + 60) throw new Error("RPT_IAT_IN_FUTURE");
  await registerNonceOnce(payload.nonce, payload.exp);

  if (options.expectedAbn && options.expectedAbn !== payload.abn) {
    throw new Error("RPT_ABN_MISMATCH");
  }
  if (options.expectedPeriod && options.expectedPeriod !== payload.bas_period) {
    throw new Error("RPT_PERIOD_MISMATCH");
  }
  if (options.expectedTotals) {
    if (
      options.expectedTotals.paygw_cents !== undefined &&
      options.expectedTotals.paygw_cents !== payload.totals.paygw_cents
    ) {
      throw new Error("RPT_TOTAL_PAYGW_MISMATCH");
    }
    if (
      options.expectedTotals.gst_cents !== undefined &&
      options.expectedTotals.gst_cents !== payload.totals.gst_cents
    ) {
      throw new Error("RPT_TOTAL_GST_MISMATCH");
    }
  }

  const { rows } = await pool.query(
    "select status, expires_at from rpt_tokens where rpt_id = $1",
    [payload.rpt_id]
  );
  if (rows.length === 0) throw new Error("RPT_UNKNOWN_ID");
  if (rows[0].status === "REVOKED") throw new Error("RPT_REVOKED");
  const dbExp = rows[0].expires_at as Date | null;
  if (dbExp && Math.floor(new Date(dbExp).getTime() / 1000) !== payload.exp) {
    throw new Error("RPT_EXP_MISMATCH");
  }

  return payload;
}
