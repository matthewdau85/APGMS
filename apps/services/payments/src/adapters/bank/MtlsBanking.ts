import axios, { AxiosInstance } from "axios";
import https from "https";
import { readFileSync } from "node:fs";
import { BankingPort, BankingResult, BpayOptions, EftOptions } from "./BankingPort.js";

function readMaybe(path?: string) {
  return path ? readFileSync(path) : undefined;
}

export class MtlsBanking implements BankingPort {
  private client: AxiosInstance;

  constructor(baseURL: string) {
    const agent = new https.Agent({
      cert: readMaybe(process.env.MTLS_CERT),
      key: readMaybe(process.env.MTLS_KEY),
      ca: readMaybe(process.env.MTLS_CA),
      rejectUnauthorized: true,
    });
    this.client = axios.create({
      baseURL,
      timeout: Number(process.env.MTLS_TIMEOUT_MS ?? "8000"),
      httpsAgent: agent,
    });
  }

  async eft(opts: EftOptions): Promise<BankingResult> {
    const { data } = await this.client.post(
      "/sim/bank/eft",
      {
        amount_cents: opts.amount_cents,
        bsb: opts.bsb,
        account: opts.account,
        reference: opts.reference,
      },
      { headers: { "Idempotency-Key": opts.idempotencyKey } }
    );
    return { provider_ref: data.provider_ref, paid_at: data.paid_at };
  }

  async bpay(opts: BpayOptions): Promise<BankingResult> {
    const { data } = await this.client.post(
      "/sim/bank/bpay",
      {
        amount_cents: opts.amount_cents,
        biller_code: opts.biller_code,
        crn: opts.crn,
        reference: opts.reference,
      },
      { headers: { "Idempotency-Key": opts.idempotencyKey } }
    );
    return { provider_ref: data.provider_ref, paid_at: data.paid_at };
  }
}
