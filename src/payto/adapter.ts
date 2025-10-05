import { getPool } from "../db/pool";
import crypto from "crypto";

export type PayToMandate = {
  id: string; abn: string; payid: string; creditorName: string;
  maxAmountCents: number; status: "ACTIVE"|"CANCELLED"; createdAt: string;
};

export const payto = {
  async createMandate(abn: string, payid: string, creditorName: string, maxAmountCents: number): Promise<PayToMandate> {
    const id = crypto.randomUUID();
    const q = await getPool().query(
      `insert into payto_mandates (id, abn, payid, creditor_name, max_amount_cents, status, created_at)
       values ($1,$2,$3,$4,$5,'ACTIVE',now())
       returning id, abn, payid, creditor_name as "creditorName", max_amount_cents as "maxAmountCents", status, created_at as "createdAt"`,
      [id, abn, payid, creditorName, maxAmountCents]
    );
    return q.rows[0];
  },
  async cancelMandate(id: string): Promise<void> {
    await getPool().query(`update payto_mandates set status='CANCELLED' where id=$1`, [id]);
  },
  async sweep(mandateId: string, amountCents: number, ref: string) {
    const c = await getPool().connect();
    try {
      await c.query("BEGIN");
      const m = await c.query(`select abn, status, max_amount_cents from payto_mandates where id=$1 for update`, [mandateId]);
      if (!m.rowCount) throw new Error("mandate not found");
      if (m.rows[0].status !== "ACTIVE") throw new Error("mandate not active");
      if (amountCents > Number(m.rows[0].max_amount_cents)) throw new Error("amount exceeds mandate limit");

      await c.query(
        `insert into payto_sweeps (mandate_id, abn, amount_cents, reference, created_at) values ($1,$2,$3,$4,now())`,
        [mandateId, m.rows[0].abn, amountCents, ref]
      );

      await c.query(
        `insert into ledger (abn, direction, amount_cents, source, meta)
         values ($1,'credit',$2,'payto_sweep',$3)`,
        [m.rows[0].abn, amountCents, { mandateId, ref }]
      );

      await c.query("COMMIT");
      return { ok: true };
    } catch (e:any) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  },
};
