import crypto from "crypto";
import { BankingPort, Tx } from "../../ports/banking";
import { FEATURES } from "../../config/features";
import { getPool } from "../../db/pool";

export class RealBanking implements BankingPort {
  private async persist(
    abn: string,
    amountCents: number,
    channel: Tx["channel"],
    reference?: string
  ): Promise<Tx> {
    const id = crypto.randomUUID();
    await getPool().query(
      `insert into bank_transfers (id, abn, amount_cents, channel, reference, status, created_at)
       values ($1,$2,$3,$4,$5,$6, now())`,
      [id, abn, amountCents, channel, reference || null, FEATURES.DRY_RUN ? "PENDING" : "PENDING"]
    );
    return { id, abn, amountCents, channel, reference, status: "PENDING" };
  }

  async eft(abn: string, amountCents: number, reference?: string) {
    return this.persist(abn, amountCents, "EFT", reference);
  }

  async bpay(abn: string, amountCents: number, reference?: string) {
    return this.persist(abn, amountCents, "BPAY", reference);
  }

  async payToSweep(_mandateId: string, amountCents: number, ref: string) {
    const abn = "unresolved-abn";
    return this.persist(abn, amountCents, "PayTo", ref);
  }
}
