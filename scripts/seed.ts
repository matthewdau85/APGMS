import { getPool } from "../src/db/pool";
async function main() {
  const db = getPool();
  await db.query("BEGIN");
  await db.query("truncate ledger, periods, bas_labels, recon_inputs, idempotency, rpt_tokens, evidence_bundles, bank_transfers, payroll_events, settlements restart identity cascade");
  await db.query(`insert into periods (abn, state, policy_threshold_bps) values ('11122233344','OPEN',100)`);
  const pid = (await db.query(`select id from periods where abn='11122233344'`)).rows[0].id;
  await db.query(`insert into bas_labels (abn, period_id, label, value_cents) values ('11122233344',$1,'W1',500000),('11122233344',$1,'W2',50000)`, [pid]);
  await db.query(`insert into recon_inputs (abn, period_id, expected_cents) values ('11122233344',$1,1000000)`, [pid]);
  await db.query("COMMIT");
  console.log(JSON.stringify({ abn: "11122233344", period_id: pid }, null, 2));
  await db.end();
}
main().catch(async (e) => { console.error(e); process.exit(1); });
