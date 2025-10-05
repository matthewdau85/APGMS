import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";
const pool = new Pool();

/**
 * @openapi
 * {
 *   "paths": {
 *     "/api/close-issue": {
 *       "post": {
 *         "summary": "Close a BAS period and issue an RPT token",
 *         "description": "Transitions the specified period to READY_RPT and returns the signed remittance payload.",
 *         "requestBody": {
 *           "required": true,
 *           "content": {
 *             "application/json": {
 *               "schema": { "$ref": "#/components/schemas/ReconcileRequest" }
 *             }
 *           }
 *         },
 *         "responses": {
 *           "200": {
 *             "description": "Issued remittance payload and signature",
 *             "content": {
 *               "application/json": {
 *                 "schema": { "$ref": "#/components/schemas/RptIssueResponse" }
 *               }
 *             }
 *           },
 *           "400": {
 *             "description": "Validation failure or blocked issuance",
 *             "content": {
 *               "application/json": {
 *                 "schema": { "$ref": "#/components/schemas/ErrorResponse" }
 *               }
 *             }
 *           }
 *         }
 *       }
 *     }
 *   },
 *   "components": {
 *     "schemas": {
 *       "ReconcileRequest": {
 *         "type": "object",
 *         "required": ["abn", "taxType", "periodId"],
 *         "properties": {
 *           "abn": { "type": "string" },
 *           "taxType": { "type": "string", "enum": ["GST", "PAYGW"] },
 *           "periodId": { "type": "string" },
 *           "thresholds": {
 *             "type": "object",
 *             "additionalProperties": { "type": "number" },
 *             "description": "Override anomaly thresholds for reconciliation"
 *           }
 *         }
 *       },
 *       "RptPayload": {
 *         "type": "object",
 *         "required": [
 *           "entity_id",
 *           "period_id",
 *           "tax_type",
 *           "amount_cents",
 *           "merkle_root",
 *           "running_balance_hash",
 *           "anomaly_vector",
 *           "thresholds",
 *           "rail_id",
 *           "reference",
 *           "expiry_ts",
 *           "nonce"
 *         ],
 *         "properties": {
 *           "entity_id": { "type": "string" },
 *           "period_id": { "type": "string" },
 *           "tax_type": { "type": "string" },
 *           "amount_cents": { "type": "integer" },
 *           "merkle_root": { "type": "string" },
 *           "running_balance_hash": { "type": "string" },
 *           "anomaly_vector": { "type": "object", "additionalProperties": { "type": "number" } },
 *           "thresholds": { "type": "object", "additionalProperties": { "type": "number" } },
 *           "rail_id": { "type": "string" },
 *           "reference": { "type": "string" },
 *           "expiry_ts": { "type": "string", "format": "date-time" },
 *           "nonce": { "type": "string" }
 *         }
 *       },
 *       "RptIssueResponse": {
 *         "type": "object",
 *         "required": ["payload", "signature"],
 *         "properties": {
 *           "payload": { "$ref": "#/components/schemas/RptPayload" },
 *           "signature": { "type": "string" }
 *         }
 *       }
 *     }
 *   }
 * }
 */
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
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

/**
 * @openapi
 * {
 *   "paths": {
 *     "/api/evidence": {
 *       "get": {
 *         "summary": "Fetch the reconciliation evidence bundle",
 *         "parameters": [
 *           { "in": "query", "name": "abn", "required": true, "schema": { "type": "string" } },
 *           { "in": "query", "name": "taxType", "required": true, "schema": { "type": "string", "enum": ["GST", "PAYGW"] } },
 *           { "in": "query", "name": "periodId", "required": true, "schema": { "type": "string" } }
 *         ],
 *         "responses": {
 *           "200": {
 *             "description": "Evidence bundle containing ledger deltas and the most recent RPT",
 *             "content": {
 *               "application/json": {
 *                 "schema": { "$ref": "#/components/schemas/EvidenceBundle" }
 *               }
 *             }
 *           }
 *         }
 *       }
 *     }
 *   },
 *   "components": {
 *     "schemas": {
 *       "LedgerDelta": {
 *         "type": "object",
 *         "required": ["ts", "amount_cents"],
 *         "properties": {
 *           "ts": { "type": "string", "format": "date-time" },
 *           "amount_cents": { "type": "integer" },
 *           "hash_after": { "type": "string", "nullable": true },
 *           "bank_receipt_hash": { "type": "string", "nullable": true }
 *         }
 *       },
 *       "EvidenceBundle": {
 *         "type": "object",
 *         "required": [
 *           "bas_labels",
 *           "rpt_payload",
 *           "rpt_signature",
 *           "owa_ledger_deltas",
 *           "bank_receipt_hash",
 *           "anomaly_thresholds",
 *           "discrepancy_log"
 *         ],
 *         "properties": {
 *           "bas_labels": { "type": "object", "additionalProperties": { "type": "string", "nullable": true } },
 *           "rpt_payload": { "$ref": "#/components/schemas/RptPayload", "nullable": true },
 *           "rpt_signature": { "type": "string", "nullable": true },
 *           "owa_ledger_deltas": { "type": "array", "items": { "$ref": "#/components/schemas/LedgerDelta" } },
 *           "bank_receipt_hash": { "type": "string", "nullable": true },
 *           "anomaly_thresholds": { "type": "object", "additionalProperties": { "type": "number" } },
 *           "discrepancy_log": { "type": "array", "items": { "type": "object" } }
 *         }
 *       }
 *     }
 *   }
 * }
 */
export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
