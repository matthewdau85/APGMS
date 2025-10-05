import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "../../src/db/pool";
import supertest from "supertest";
import http from "http";
import appFactory from "../helpers/appFactory";

let server: http.Server;

describe("E2E: issue RPT -> evidence", () => {
  beforeAll(async () => {
    const app = await appFactory();
    server = app.listen(0);
    const pool = getPool();

    await pool.query("BEGIN");
    await pool.query("truncate ledger, periods, idempotency, rpt_tokens, evidence_bundles, recon_inputs restart identity cascade");
    await pool.query(`insert into periods (abn, state, policy_threshold_bps) values ('11122233344','OPEN',100)`);
    const pidRes = await pool.query(`select id from periods where abn='11122233344'`);
    const pid = pidRes.rows[0].id;
    await pool.query(`insert into recon_inputs (abn, period_id, expected_cents) values ('11122233344',$1,10000)`, [pid]);
    await pool.query(`insert into ledger (abn, period_id, direction, amount_cents, source) values ('11122233344',$1,'credit',10000,'seed')`, [pid]);
    await pool.query("COMMIT");
  });

  afterAll(async () => {
    await getPool().end();
    server.close();
  });

  it("closes, issues RPT, and exposes evidence", async () => {
    const req = supertest(server);

    const r1 = await req.post("/api/reconcile/close-and-issue").send({ abn: "11122233344", period_id: 1 });
    expect(r1.status).toBe(200);
    expect(r1.body.ok).toBe(true);
    expect(r1.body.within).toBe(true);
    expect(r1.body.rpt?.token).toBeTruthy();

    const r2 = await req.get("/api/evidence/11122233344/1");
    expect(r2.status).toBe(200);
    expect(r2.body.rpt_token).toBe(r1.body.rpt.token);
    expect(typeof r2.body.delta_cents).toBe("number");
  });
});
