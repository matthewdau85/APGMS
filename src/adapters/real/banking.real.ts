import https from "node:https";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { BankingPort } from "../../ports/banking";
import { assertAbnAllowed } from "../../rails/validators";
import { postJson } from "./http";

type BankingChannel = "EFT" | "BPAY" | "PAYTOSWEEP";

type IntentRecord = {
  id: string;
  status: string;
};

const pool = new Pool();

const ensureBankingTable = pool
  .query(`
    create table if not exists banking_intents (
      id uuid primary key,
      channel text not null,
      payload jsonb not null,
      status text not null,
      response jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  .then(() => undefined);

export class RealBanking implements BankingPort {
  private readonly agent?: https.Agent;
  private readonly dryRun: boolean;
  private readonly endpoints: Record<BankingChannel, string | undefined>;
  private readonly timeoutMs: number;

  constructor() {
    this.dryRun = process.env.DRY_RUN === "true";
    const cert = process.env.MTLS_CERT;
    const key = process.env.MTLS_KEY;
    const ca = process.env.MTLS_CA;

    this.agent = cert && key
      ? new https.Agent({
          cert,
          key,
          ca,
          rejectUnauthorized: Boolean(ca),
        })
      : undefined;

    this.timeoutMs = Number(process.env.BANKING_TIMEOUT_MS ?? "10000");

    this.endpoints = {
      EFT: process.env.BANKING_EFT_ENDPOINT,
      BPAY: process.env.BANKING_BPAY_ENDPOINT,
      PAYTOSWEEP: process.env.BANKING_PAYTOSWEEP_ENDPOINT,
    };
  }

  async eft(abn: string, amountCents: number, reference?: string): Promise<IntentRecord> {
    await assertAbnAllowed(abn);
    return this.dispatch("EFT", { abn, amountCents, reference });
  }

  async bpay(abn: string, crn: string, amountCents: number): Promise<IntentRecord> {
    await assertAbnAllowed(abn);
    return this.dispatch("BPAY", { abn, crn, amountCents });
  }

  async payToSweep(mandateId: string, amountCents: number, ref: string): Promise<IntentRecord> {
    return this.dispatch("PAYTOSWEEP", { mandateId, amountCents, ref });
  }

  private async dispatch(channel: BankingChannel, payload: Record<string, unknown>): Promise<IntentRecord> {
    await ensureBankingTable;
    const id = uuidv4();
    await pool.query(
      "insert into banking_intents(id, channel, payload, status) values ($1, $2, $3::jsonb, $4)",
      [id, channel, JSON.stringify(payload), this.dryRun ? "DRY_RUN" : "PENDING"]
    );

    if (this.dryRun) {
      return { id, status: "DRY_RUN" };
    }

    const endpoint = this.getEndpoint(channel);

    try {
      const response = await postJson(endpoint, payload, this.agent, this.timeoutMs);
      if (response.statusCode >= 400) {
        throw new Error(`BANKING_HTTP_${response.statusCode}`);
      }
      const providerStatus = response.body?.status ?? "SUBMITTED";
      const providerId = response.body?.id ?? id;
      await pool.query(
        "update banking_intents set status=$1, response=$2::jsonb, updated_at=now() where id=$3",
        [providerStatus, JSON.stringify(response.body ?? null), id]
      );
      return { id: providerId, status: providerStatus };
    } catch (error) {
      await pool.query(
        "update banking_intents set status=$1, response=$2::jsonb, updated_at=now() where id=$3",
        ["FAILED", JSON.stringify({ error: (error as Error).message }), id]
      );
      throw error;
    }
  }

  private getEndpoint(channel: BankingChannel): string {
    const endpoint = this.endpoints[channel];
    if (!endpoint) {
      throw new Error(`Missing endpoint for ${channel}`);
    }
    return endpoint;
  }
}
