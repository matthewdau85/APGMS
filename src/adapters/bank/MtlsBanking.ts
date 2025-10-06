import https from "https";
import { URL } from "url";

export type MtlsBankingConfig = {
  baseURL: string;
  agent?: https.Agent;
  timeoutMs?: number;
};

type CommonParams = {
  abn: string;
  amountCents: number;
  idemKey?: string;
};

type EftParams = CommonParams & { bsb: string; acct: string };
type BpayParams = CommonParams & { crn: string };

export type BankingResponse = { provider_ref: string; paid_at: string };

export class MtlsBanking {
  private baseURL: string;
  private agent?: https.Agent;
  private timeout: number;

  constructor(config: MtlsBankingConfig) {
    this.baseURL = config.baseURL;
    this.agent = config.agent;
    this.timeout = config.timeoutMs ?? 10_000;
  }

  async eft(params: EftParams): Promise<BankingResponse> {
    return this.post("/eft", {
      abn: params.abn,
      bsb: params.bsb,
      account: params.acct,
      amount_cents: params.amountCents,
    }, params.idemKey);
  }

  async bpay(params: BpayParams): Promise<BankingResponse> {
    return this.post("/bpay", {
      abn: params.abn,
      crn: params.crn,
      amount_cents: params.amountCents,
    }, params.idemKey);
  }

  private post(pathname: string, payload: any, idemKey?: string): Promise<BankingResponse> {
    const url = new URL(pathname, this.baseURL);
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body).toString(),
    };
    if (idemKey) headers["Idempotency-Key"] = idemKey;

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: "POST",
          agent: this.agent,
          headers,
          timeout: this.timeout,
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = data ? JSON.parse(data) : {};
                resolve(this.normalize(parsed));
              } catch (err) {
                reject(err);
              }
            } else {
              reject(new Error(`Banking provider returned HTTP ${res.statusCode}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error("Banking request timed out"));
      });
      req.write(body);
      req.end();
    });
  }

  private normalize(payload: any): BankingResponse {
    const provider_ref = String(payload?.provider_ref || payload?.receipt_id || payload?.id || "").trim();
    const paid_at = payload?.paid_at ? new Date(payload.paid_at).toISOString() : new Date().toISOString();
    if (!provider_ref) {
      throw new Error("Banking provider did not return provider_ref");
    }
    return { provider_ref, paid_at };
  }
}

export function buildMtlsAgent(): https.Agent {
  return new https.Agent({
    cert: process.env.MTLS_CERT,
    key: process.env.MTLS_KEY,
    ca: process.env.MTLS_CA,
    rejectUnauthorized: true,
  });
}
