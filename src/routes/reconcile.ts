import { Router } from "express";
import { getPool } from "../db/pool";
import { nextState } from "../recon/stateMachine";
import { issueRPT } from "../rpt/issuer";
import crypto from "crypto";
export const router = Router();

router.post("/close-and-issue", async (req, res) => {
  const { abn, period_id } = req.body ?? {};
  if (!abn || !period_id) return res.status(400).json({ error: "abn, period_id required" });

  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const p = await c.query(
      `select id, state, policy_threshold_bps from periods where id=$1 and abn=$2 for update`,
      [period_id, abn]
    );
    if (!p.rowCount) throw new Error("period not found");
    const period = p.rows[0];

    const exp = await c.query(
      `select coalesce(sum(expected_cents),0) as cents from recon_inputs where period_id=$1 and abn=$2`,
      [period_id, abn]
    );
    const act = await c.query(
      `select coalesce(sum(case when direction='credit' then amount_cents else -amount_cents end),0) as cents
         from ledger where abn=$1 and period_id=$2`,
      [abn, period_id]
    );
    const expC = Number(exp.rows[0].cents), actC = Number(act.rows[0].cents);
    const delta = actC - expC;
    const tolBps = Number(period.policy_threshold_bps ?? 100);
    const within = Math.abs(delta) * 10000 <= Math.max(1, expC) * tolBps;

    const headRow = await c.query(
      `select coalesce(max(hash_head), '') as head from ledger where abn=$1 and period_id=$2`,
      [abn, period_id]
    );
    const anomalyHash = crypto.createHash("sha256")
      .update(JSON.stringify({ expC, actC, delta, tolBps }))
      .digest("hex");
    const combined = crypto.createHash("sha256")
      .update((headRow.rows[0]?.head ?? "") + anomalyHash, "utf8")
      .digest("hex");

    const next = nextState(period.state, within ? "RECON_OK" : "RECON_FAIL");
    await c.query(`update periods set state=$1, hash_head=$2 where id=$3`, [next, combined, period_id]);

    let rpt: { token: string } | null = null;
    if (within) {
      rpt = await issueRPT(c, { abn, periodId: period_id, head: combined });
      await c.query(
        `insert into evidence_bundles (abn, period_id, rpt_token, delta_cents, tolerance_bps, details)
         values ($1, $2, $3, $4, $5, $6)`,
        [abn, period_id, rpt.token, delta, tolBps, { expC, actC, anomalyHash }]
      );
    } else {
      await c.query(
        `insert into evidence_bundles (abn, period_id, rpt_token, delta_cents, tolerance_bps, details)
         values ($1, $2, null, $3, $4, $5)`,
        [abn, period_id, delta, tolBps, { expC, actC, anomalyHash }]
      );
    }

    await c.query("COMMIT");
    res.json({ ok: true, within, rpt });
  } catch (e:any) {
    await c.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally { c.release(); }
});
