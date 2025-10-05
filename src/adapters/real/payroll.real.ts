import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { PayrollPort } from "../../ports/payroll";
import { assertAbnAllowed } from "../../rails/validators";
import { postJson } from "./http";

const pool = new Pool();

const ensurePayrollTable = pool
  .query(`
    create table if not exists payroll_events (
      id uuid primary key,
      abn text not null,
      gross_cents integer not null,
      payg_cents integer not null,
      occurred_at timestamptz not null,
      payload jsonb not null,
      received_at timestamptz not null default now()
    )
  `)
  .then(() => undefined);

export class RealPayroll implements PayrollPort {
  private readonly webhookEndpoint?: string;

  constructor() {
    this.webhookEndpoint = process.env.PAYROLL_WEBHOOK_ENDPOINT;
  }

  async ingestStp(event: {
    abn: string;
    grossCents: number;
    paygCents: number;
    occurredAt: string;
  }): Promise<void> {
    await ensurePayrollTable;
    await assertAbnAllowed(event.abn);
    const id = uuidv4();
    await pool.query(
      "insert into payroll_events(id, abn, gross_cents, payg_cents, occurred_at, payload) values ($1,$2,$3,$4,$5,$6::jsonb)",
      [id, event.abn, event.grossCents, event.paygCents, event.occurredAt, JSON.stringify(event)]
    );

    if (!this.webhookEndpoint) {
      return;
    }

    const response = await postJson(this.webhookEndpoint, { id, ...event });
    if (response.statusCode >= 400) {
      throw new Error(`PAYROLL_HTTP_${response.statusCode}`);
    }
  }
}
