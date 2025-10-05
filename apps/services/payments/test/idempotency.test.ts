import express from "express";
import { AddressInfo } from "net";
import { once } from "events";
import { createHash, randomUUID } from "crypto";
import { Pool } from "pg";

import {
  createExpressIdempotencyMiddleware,
  derivePayoutKey,
  installFetchIdempotencyPropagation,
} from "../../../../libs/idempotency/express.js";

describe("idempotency", () => {
  const connectionString =
    process.env.DATABASE_URL || "postgres://apgms:apgms_pw@127.0.0.1:5432/apgms";
  const pool = new Pool({ connectionString });
  installFetchIdempotencyPropagation();

  afterAll(async () => {
    await pool.end();
  });

  test("concurrent payout requests share one mutation and response", async () => {
    const app = express();
    app.use(express.json());

    const idem = createExpressIdempotencyMiddleware({
      pool,
      deriveKey: (req) => {
        const path = (req.path || req.originalUrl || "").toLowerCase();
        if (path === "/payout") {
          return derivePayoutKey(req.body) ?? undefined;
        }
        return undefined;
      },
    });
    app.use(idem);

    const abn = "12345678901";
    const taxType = "GST";
    const periodId = "2025-10";
    const amountCents = -5000;
    const semanticKey = derivePayoutKey({ abn, periodId, amountCents });

    await pool.query("DELETE FROM idempotency_keys WHERE id=$1", [semanticKey]);
    await pool.query(
      "DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );

    app.post("/payout", async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: last } = await client.query(
          `SELECT balance_after_cents FROM owa_ledger
             WHERE abn=$1 AND tax_type=$2 AND period_id=$3
             ORDER BY id DESC LIMIT 1`,
          [abn, taxType, periodId]
        );
        const prev = Number(last[0]?.balance_after_cents ?? 0);
        const amt = Number(req.body?.amountCents ?? 0);
        const newBal = prev + amt;
        const transfer = randomUUID();
        const { rows: inserted } = await client.query(
          `INSERT INTO owa_ledger
             (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,now())
           RETURNING id,balance_after_cents`,
          [abn, taxType, periodId, transfer, amt, newBal]
        );
        await client.query("COMMIT");
        res.json({ ok: true, ledger_id: inserted[0].id, balance_after_cents: inserted[0].balance_after_cents });
      } catch (err: any) {
        await client.query("ROLLBACK");
        res.status(500).json({ error: "ledger insert failed", detail: String(err?.message || err) });
      } finally {
        client.release();
      }
    });

    const server = app.listen(0);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const body = { abn, taxType, periodId, amountCents };
    const requests = Array.from({ length: 10 }, () =>
      fetch(`http://127.0.0.1:${port}/payout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );

    const responses = await Promise.all(requests);
    const payloads = await Promise.all(responses.map((r) => r.json()));
    responses.forEach((r) => expect(r.status).toBe(200));

    const serialized = payloads.map((p) => JSON.stringify(p));
    expect(new Set(serialized).size).toBe(1);

    const hash = createHash("sha256").update(serialized[0]).digest("hex");
    const { rows: ledgerCount } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );
    expect(ledgerCount[0].count).toBe(1);

    const { rows: idemRows } = await pool.query(
      "SELECT status, response_hash FROM idempotency_keys WHERE id=$1",
      [semanticKey]
    );
    expect(idemRows[0].status).toBe("applied");
    expect(idemRows[0].response_hash).toBe(hash);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
