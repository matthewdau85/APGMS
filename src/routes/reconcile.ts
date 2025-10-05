// src/routes/reconcile.ts
// Import the routine that issues RPT documents used when closing and issuing.
import { issueRPT } from "../rpt/issuer";
// Import the helper that builds evidence bundles for audit responses.
import { buildEvidenceBundle } from "../evidence/bundle";
// Import the payment rail helpers that resolve destinations and release funds.
import { releasePayment, resolveDestination } from "../rails/adapter";
// Import the PayTo adapter so we can initiate sweeps against linked accounts.
import { debit as paytoDebit } from "../payto/adapter";
// Import the parser that splits settlement CSV files into structured records.
import { parseSettlementCSV } from "../settlement/splitParser";
// Import the PostgreSQL client pool used for database access.
import { Pool } from "pg";
// Create a shared connection pool instance for all route handlers in this module.
const pool = new Pool();
// ---
// Export the closeAndIssue handler which finalizes a reporting period and issues an RPT.
export async function closeAndIssue(req: any, res: any) {
  // Extract the expected fields from the incoming request body.
  const { abn, taxType, periodId, thresholds } = req.body;
  // Provide fallback thresholds when the caller does not supply overrides.
  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  // Use try/catch so we can surface validation or processing errors cleanly.
  try {
    // Issue the RPT document using the provided identifiers and risk thresholds.
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    // Return the successful RPT payload back to the caller.
    return res.json(rpt);
  } catch (e: any) {
    // Convert any thrown error into a 400 response with the error message.
    return res.status(400).json({ error: e.message });
  }
  // End of closeAndIssue handler.
}
// ---
// Export the payAto handler which releases funds to the ATO via the configured payment rail.
export async function payAto(req: any, res: any) {
  // Extract identifiers and the requested rail from the body (EFT or BPAY).
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  // Look up the most recent RPT token for the specified period so we have payment context.
  const pr = await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId]);
  // If no token exists we cannot release payment and must return an error.
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  // Grab the payload column from the fetched row to access reference and amount data.
  const payload = pr.rows[0].payload;
  // Wrap the destination resolution and release in try/catch so errors return 400 responses.
  try {
    // Resolve the settlement destination details for the given rail and reference.
    await resolveDestination(abn, rail, payload.reference);
    // Request the payment release using the stored payload information.
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    // Mark the period as released in the database for downstream processing.
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    // Send the release response body back to the caller.
    return res.json(r);
  } catch (e: any) {
    // Translate failures into a 400 status with the error description.
    return res.status(400).json({ error: e.message });
  }
  // End of payAto handler.
}
// ---
// Export the paytoSweep handler which debits a linked account using PayTo.
export async function paytoSweep(req: any, res: any) {
  // Pull the ABN, amount, and reference string from the request body.
  const { abn, amount_cents, reference } = req.body;
  // Initiate the PayTo debit using the adapter with the supplied details.
  const r = await paytoDebit(abn, amount_cents, reference);
  // Return the debit response so the caller knows the sweep result.
  return res.json(r);
  // End of paytoSweep handler.
}
// ---
// Export the settlementWebhook handler which processes settlement CSV payloads.
export async function settlementWebhook(req: any, res: any) {
  // Extract the CSV text from the request body (defaulting to empty string).
  const csvText = req.body?.csv || "";
  // Parse the CSV text into row objects using the dedicated parser helper.
  const rows = parseSettlementCSV(csvText);
  // TODO reminder describing ledger posting work for each settlement row.
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  // Respond with the number of ingested rows to acknowledge receipt.
  return res.json({ ingested: rows.length });
  // End of settlementWebhook handler.
}
// ---
// Export the evidence handler which returns an evidence bundle for auditors.
export async function evidence(req: any, res: any) {
  // Extract query string identifiers from the request to target the correct period.
  const { abn, taxType, periodId } = req.query as any;
  // Build the evidence bundle and return it directly to the caller.
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
  // End of evidence handler.
}
