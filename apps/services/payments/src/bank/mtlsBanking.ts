import axios, { AxiosInstance } from "axios";
import https from "https";
import fs from "node:fs";
import path from "node:path";
import { SimRail } from "./simRail.js";
import { BankingPort, ReleaseRequest, ReleaseResult } from "./types.js";
import { DbSimSettlementRepository } from "./simRail.js";
import type { Pool } from "pg";

type MtlsOptions = {
  pool: Pool;
};

export class MtlsBanking implements BankingPort {
  private readonly simFallback: SimRail;
  private readonly client: AxiosInstance;
  private readonly enabled: boolean;

  constructor(options: MtlsOptions) {
    this.simFallback = new SimRail({ repository: new DbSimSettlementRepository(options.pool) });

    const baseURL = process.env.SIM_RAIL_BASE_URL;
    this.enabled = Boolean(baseURL);

    const certPath = process.env.MTLS_CERT ? path.resolve(process.env.MTLS_CERT) : undefined;
    const keyPath = process.env.MTLS_KEY ? path.resolve(process.env.MTLS_KEY) : undefined;
    const caPath = process.env.MTLS_CA ? path.resolve(process.env.MTLS_CA) : undefined;

    const agent = new https.Agent({
      cert: certPath ? fs.readFileSync(certPath) : undefined,
      key: keyPath ? fs.readFileSync(keyPath) : undefined,
      ca: caPath ? fs.readFileSync(caPath) : undefined,
      rejectUnauthorized: true,
    });

    this.client = axios.create({
      baseURL: baseURL || "",
      httpsAgent: agent,
      timeout: Number(process.env.MTLS_TIMEOUT_MS || 8000),
    });
  }

  async release(request: ReleaseRequest): Promise<ReleaseResult> {
    if (!this.enabled) {
      return this.simFallback.release(request);
    }

    const payload = {
      abn: request.abn,
      tax_type: request.taxType,
      period_id: request.periodId,
      amount_cents: request.amountCents,
      destination: request.destination,
      idem_key: request.idemKey,
    };

    const response = await this.client.post("/sim/rail/release", payload, {
      headers: { "content-type": "application/json" },
    });

    const body = response.data || {};
    const paidAt = body.paid_at ? new Date(body.paid_at) : new Date();
    return {
      providerRef: body.provider_ref,
      paidAt,
      amountCents: Number(body.amount_cents ?? Math.abs(request.amountCents)),
    };
  }
}

