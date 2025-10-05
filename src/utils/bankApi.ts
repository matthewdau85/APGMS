import { getPool } from "../db/pool";
import crypto from "crypto";

export const bankApi = {
  async eft(abn: string, amountCents: number, reference?: string) {
    const id = crypto.randomUUID();
    await getPool().query(
      `insert into bank_transfers (id, abn, amount_cents, channel, reference, status, created_at)
       values ($1,$2,$3,'EFT',$4,'PENDING', now())`,
      [id, abn, amountCents, reference || null]
    );
    return { id, abn, amountCents, channel: "EFT", reference, status: "PENDING" };
  },
  async bpay(abn: string, amountCents: number, reference?: string) {
    const id = crypto.randomUUID();
    await getPool().query(
      `insert into bank_transfers (id, abn, amount_cents, channel, reference, status, created_at)
       values ($1,$2,$3,'BPAY',$4,'PENDING', now())`,
      [id, abn, amountCents, reference || null]
    );
    return { id, abn, amountCents, channel: "BPAY", reference, status: "PENDING" };
  }
};
