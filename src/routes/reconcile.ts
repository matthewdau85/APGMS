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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const p = await client.query(
      `select id, state, policy_threshold_bps
         from periods
        where id = $1 and abn = $2
        for update`,
      [period_id, abn]
    );
    if (!p.rowCount) throw new Error("period not found");
    const period = p.rows[0];

    const expected = await client.query(
      `select coalesce(sum(expected_cents),0) as cents
         from recon_inputs where period_id = $1 and abn = $2`,
      [period_id, abn]
    );
    const actual = await client.query(
      `select coalesce(sum(case when direction='credit' then amount_cents else -amount_cents end),0) as cents
         from ledger where abn = $1 and period_id = $2`,
      [abn, period_id]
    );
    const expC = Number(expected.rows[0].cents);
    const actC = Number(actual.rows[0].cents);
    const delta = actC - expC;
    const toleranceBps = Number(period.policy_threshold_bps ?? 100);

    const within = Math.abs(delta) * 10_000 <= Math.max(1, expC) * toleranceBps;

    const head = await client.query(
      `select coalesce(max(hash_head), '') as head from ledger where abn = $1 and period_id = $2`,
      [abn, period_id]
    );
    const anomalyHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ expC, actC, delta, toleranceBps }))
      .digest("hex");
    const combined = crypto
      .createHash("sha256")
      .update((head.rows[0]?.head ?? "") + anomalyHash, "utf8")
      .digest("hex");

    const next = nextState(period.state, within ? "RECON_OK" : "RECON_FAIL");
    await client.query(`update periods set state = $1, hash_head = $2 where id = $3`, [
      next,
      combined,
      period_id,
    ]);

    let rpt: { token: string } | null = null;
    if (within) {
      rpt = await issueRPT(client, { abn, periodId: period_id, head: combined });
      await client.query(
        `insert into evidence_bundles (abn, period_id, rpt_token, delta_cents, tolerance_bps, details)
         values ($1, $2, $3, $4, $5, $6)`,
        [abn, period_id, rpt.token, delta, toleranceBps, { expC, actC, anomalyHash }]
      );
    } else {
      await client.query(
        `insert into evidence_bundles (abn, period_id, rpt_token, delta_cents, tolerance_bps, details)
         values ($1, $2, null, $3, $4, $5)`,
        [abn, period_id, delta, toleranceBps, { expC, actC, anomalyHash }]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true, within, rpt });
  } catch (e: any) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});
