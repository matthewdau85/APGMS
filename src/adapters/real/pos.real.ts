import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { PosPort } from "../../ports/pos";
import { assertAbnAllowed } from "../../rails/validators";
import { postJson } from "./http";

const pool = new Pool();

const ensurePosTable = pool
  .query(`
    create table if not exists pos_events (
      id uuid primary key,
      abn text not null,
      gross_cents integer not null,
      gst_cents integer not null,
      occurred_at timestamptz not null,
      payload jsonb not null,
      received_at timestamptz not null default now()
    )
  `)
  .then(() => undefined);

export class RealPos implements PosPort {
  private readonly webhookEndpoint?: string;

  constructor() {
    this.webhookEndpoint = process.env.POS_WEBHOOK_ENDPOINT;
  }

  async ingestSale(event: {
    abn: string;
    grossCents: number;
    gstCents: number;
    occurredAt: string;
  }): Promise<void> {
    await ensurePosTable;
    await assertAbnAllowed(event.abn);
    const id = uuidv4();
    await pool.query(
      "insert into pos_events(id, abn, gross_cents, gst_cents, occurred_at, payload) values ($1,$2,$3,$4,$5,$6::jsonb)",
      [id, event.abn, event.grossCents, event.gstCents, event.occurredAt, JSON.stringify(event)]
    );

    if (!this.webhookEndpoint) {
      return;
    }

    const response = await postJson(this.webhookEndpoint, { id, ...event });
    if (response.statusCode >= 400) {
      throw new Error(`POS_HTTP_${response.statusCode}`);
    }
  }
}
