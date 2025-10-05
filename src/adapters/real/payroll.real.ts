import { PayrollPort } from "../../ports/payroll";
import { getPool } from "../../db/pool";

export class RealPayroll implements PayrollPort {
  async ingest(abn: string, grossCents: number, paygCents: number, occurredAtISO: string) {
    await getPool().query(
      `insert into payroll_events (id, abn, gross_cents, payg_cents, occurred_at)
       values (gen_random_uuid(), $1, $2, $3, $4)`,
      [abn, grossCents, paygCents, occurredAtISO]
    );
  }
}
