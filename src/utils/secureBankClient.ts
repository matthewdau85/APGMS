import { Agent, Dispatcher } from "undici";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

export class BankApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly details?: any;

  constructor(statusCode: number, message: string, code?: string, details?: any) {
    super(message);
    this.name = "BankApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

type SignatureMetadata = {
  type: string;
  context: string;
  amount_cents: number;
  debit_account: string;
  credit_account?: string | null;
  reference?: string | null;
  bank_reference?: string | null;
};

type SecureBankClientOptions = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  defaultDebitAccount?: string;
  dispatcher?: Dispatcher;
  scope?: string;
  pool?: Pool;
  paytoBaseUrl?: string;
  paytoClientId?: string;
  paytoClientSecret?: string;
  paytoScope?: string;
};

type TransferArgs = {
  amountCents: number;
  debitAccountAlias: string;
  creditAccountAlias: string;
  purpose: string;
  narrative?: string;
  requestedAt?: string;
};

type TaxTransferArgs = {
  paygwCents: number;
  gstCents: number;
  reference: string;
  debitAccountAlias: string;
};

type PayToMandateArgs = {
  abn: string;
  capCents: number;
  reference: string;
};

type PayToDebitArgs = {
  mandateId: string;
  amountCents: number;
  debtorAbn: string;
  reference: string;
};

type AccountAliasResolver = (alias: string) => string;

const defaultScope = "payments payto";

function dollarsToCents(amount: number) {
  return Math.round(amount * 100);
}

export class SecureBankClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly dispatcher?: Dispatcher;
  private readonly scope: string;
  private readonly paytoBaseUrl?: string;
  private readonly paytoClientId?: string;
  private readonly paytoClientSecret?: string;
  private readonly paytoScope: string;
  private readonly pool: Pool;
  private readonly resolveAlias: AccountAliasResolver;
  private token?: { value: string; expiresAt: number };
  private paytoToken?: { value: string; expiresAt: number };
  private ensureSignatureTablePromise?: Promise<void>;

  constructor(options: SecureBankClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.dispatcher = options.dispatcher;
    this.scope = options.scope || defaultScope;
    this.paytoBaseUrl = options.paytoBaseUrl?.replace(/\/$/, "");
    this.paytoClientId = options.paytoClientId;
    this.paytoClientSecret = options.paytoClientSecret;
    this.paytoScope = options.paytoScope || this.scope;
    this.pool = options.pool || new Pool();

    const envAliases = Object.entries(process.env)
      .filter(([key]) => key.startsWith("BANK_API_ACCOUNT_"))
      .reduce((acc, [key, value]) => {
        if (!value) return acc;
        const alias = key.replace("BANK_API_ACCOUNT_", "");
        acc[alias] = value;
        return acc;
      }, {} as Record<string, string>);

    this.resolveAlias = (alias: string) => {
      if (!alias) {
        throw new Error("Account alias must be provided");
      }
      if (alias.startsWith("acct_")) {
        return alias;
      }
      if (alias === "__default__") {
        const mapped = options.defaultDebitAccount;
        if (!mapped) throw new Error("No default debit account configured for bank client");
        return mapped;
      }
      const envKey = alias
        .replace(/[^a-zA-Z0-9]/g, "_")
        .toUpperCase();
      const direct = envAliases[envKey];
      if (direct) return direct;
      const prefixed = envAliases[`ACCOUNT_${envKey}`];
      if (prefixed) return prefixed;
      const envVar = `BANK_API_ACCOUNT_${envKey}`;
      const fallback = process.env[envVar];
      if (fallback) return fallback;
      throw new Error(`Missing BANK_API_ACCOUNT mapping for alias '${alias}'. Expected env ${envVar}`);
    };
  }

  private async ensureSignatureTable() {
    if (!this.ensureSignatureTablePromise) {
      this.ensureSignatureTablePromise = this.pool.query(`
        CREATE TABLE IF NOT EXISTS bank_transaction_signatures (
          signature TEXT PRIMARY KEY,
          metadata  JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `).then(() => undefined);
    }
    return this.ensureSignatureTablePromise;
  }

  private async persistSignature(signature: string, metadata: SignatureMetadata) {
    await this.ensureSignatureTable();
    await this.pool.query(
      `INSERT INTO bank_transaction_signatures(signature, metadata)
       VALUES ($1,$2)
       ON CONFLICT (signature) DO UPDATE SET metadata = EXCLUDED.metadata`,
      [signature, metadata]
    );
  }

  private async getAccessToken(context: "bank" | "payto" = "bank"): Promise<string> {
    const now = Date.now();
    const isPayTo = context === "payto" && this.paytoClientId && this.paytoClientSecret;
    const tokenCache = isPayTo ? this.paytoToken : this.token;
    if (tokenCache && tokenCache.expiresAt - 30_000 > now) {
      return tokenCache.value;
    }
    const clientId = isPayTo ? this.paytoClientId! : this.clientId;
    const clientSecret = isPayTo ? this.paytoClientSecret! : this.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error("Bank API credentials (client id/secret) are not configured");
    }
    const scope = isPayTo ? this.paytoScope : this.scope;
    const base = isPayTo && this.paytoBaseUrl ? this.paytoBaseUrl : this.baseUrl;
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({ grant_type: "client_credentials", scope });
    const res = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${auth}`,
      },
      body,
      dispatcher: this.dispatcher,
    });
    const data = await this.parseResponse(res);
    if (!data?.access_token) {
      throw new Error("Bank API did not return an access token");
    }
    const expiresIn = Number(data.expires_in ?? 300);
    const cache = { value: data.access_token, expiresAt: now + expiresIn * 1000 };
    if (isPayTo) {
      this.paytoToken = cache;
    } else {
      this.token = cache;
    }
    return data.access_token;
  }

  private async parseResponse(res: Response) {
    const text = await res.text();
    if (!text) return res.ok ? null : undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: any,
    idempotencyKey?: string,
    context: "bank" | "payto" = "bank"
  ): Promise<T> {
    const token = await this.getAccessToken(context);
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    if (idempotencyKey) {
      headers["idempotency-key"] = idempotencyKey;
    }
    const base = context === "payto" && this.paytoBaseUrl ? this.paytoBaseUrl : this.baseUrl;
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const res = await fetch(url, {
      method,
      headers,
      body: payload,
      dispatcher: this.dispatcher,
    });
    const parsed = await this.parseResponse(res);
    if (!res.ok) {
      const message = typeof parsed === "string" ? parsed : parsed?.message || parsed?.error || `HTTP ${res.status}`;
      const code = typeof parsed === "object" && parsed ? parsed.code || parsed.error_code : undefined;
      throw new BankApiError(res.status, message, code, parsed);
    }
    return parsed as T;
  }

  private mapAlias(alias: string, fallbackDefault = false): string {
    if (fallbackDefault && !alias) {
      return this.resolveAlias("__default__");
    }
    return this.resolveAlias(alias || "__default__");
  }

  async submitStpReport(payload: any) {
    await this.request("POST", "/reports/stp", payload, randomUUID());
  }

  async createStandaloneSignature(amountDollars: number, creditAlias: string, context = "manual") {
    const amountCents = dollarsToCents(amountDollars);
    const creditAccount = this.mapAlias(creditAlias);
    const debitAccount = this.mapAlias("__default__", true);
    const result = await this.request<{ signature: string; bank_reference?: string }>(
      "POST",
      "/payments/signatures",
      {
        amount_cents: amountCents,
        debit_account: debitAccount,
        credit_account: creditAccount,
        context,
      },
      randomUUID()
    );
    const signature = result.signature;
    await this.persistSignature(signature, {
      type: "SIGNATURE",
      context,
      amount_cents: amountCents,
      debit_account: debitAccount,
      credit_account: creditAccount,
      reference: null,
      bank_reference: result.bank_reference ?? null,
    });
    return signature;
  }

  async transfer(args: TransferArgs) {
    const debitAccount = this.mapAlias(args.debitAccountAlias, true);
    const creditAccount = this.mapAlias(args.creditAccountAlias);
    const res = await this.request<{ bank_reference: string; signature: string }>(
      "POST",
      "/payments/transfers",
      {
        amount_cents: args.amountCents,
        debit_account: debitAccount,
        credit_account: creditAccount,
        purpose: args.purpose,
        narrative: args.narrative,
        requested_at: args.requestedAt || new Date().toISOString(),
      },
      randomUUID()
    );
    await this.persistSignature(res.signature, {
      type: "TRANSFER",
      context: args.purpose,
      amount_cents: args.amountCents,
      debit_account: debitAccount,
      credit_account: creditAccount,
      reference: args.narrative ?? null,
      bank_reference: res.bank_reference,
    });
    return res;
  }

  async verifyAvailableFunds(requiredCents: number) {
    const debitAccount = this.mapAlias("__default__", true);
    const res = await this.request<{ available_cents: number }>(
      "GET",
      `/accounts/${encodeURIComponent(debitAccount)}/balance`
    );
    return Number(res.available_cents) >= requiredCents;
  }

  async transferTaxAmounts(args: TaxTransferArgs) {
    const debitAccount = this.mapAlias(args.debitAccountAlias, true);
    const res = await this.request<{ signature: string; bank_reference: string }>(
      "POST",
      "/payments/tax",
      {
        debit_account: debitAccount,
        paygw_cents: args.paygwCents,
        gst_cents: args.gstCents,
        reference: args.reference,
      },
      randomUUID()
    );
    await this.persistSignature(res.signature, {
      type: "TAX_TRANSFER",
      context: "ATO_SETTLEMENT",
      amount_cents: args.paygwCents + args.gstCents,
      debit_account: debitAccount,
      credit_account: null,
      reference: args.reference,
      bank_reference: res.bank_reference,
    });
    return res;
  }

  async createPayToMandate(args: PayToMandateArgs) {
    return this.request<any>(
      "POST",
      "/payto/mandates",
      {
        abn: args.abn,
        cap_cents: args.capCents,
        reference: args.reference,
      },
      randomUUID(),
      "payto"
    );
  }

  async debitPayToMandate(args: PayToDebitArgs) {
    return this.request<any>(
      "POST",
      `/payto/mandates/${encodeURIComponent(args.mandateId)}/debit`,
      {
        amount_cents: args.amountCents,
        debtor_abn: args.debtorAbn,
        reference: args.reference,
      },
      randomUUID(),
      "payto"
    );
  }

  async cancelPayToMandate(mandateId: string) {
    return this.request<any>(
      "POST",
      `/payto/mandates/${encodeURIComponent(mandateId)}/cancel`,
      {},
      randomUUID(),
      "payto"
    );
  }
}

function buildDispatcher(): Dispatcher | undefined {
  const caPath = process.env.BANK_TLS_CA;
  const certPath = process.env.BANK_TLS_CERT;
  const keyPath = process.env.BANK_TLS_KEY;
  if (!caPath && !certPath && !keyPath) {
    return undefined;
  }
  return new Agent({
    connect: {
      ca: caPath ? readFileSync(resolve(caPath)) : undefined,
      cert: certPath ? readFileSync(resolve(certPath)) : undefined,
      key: keyPath ? readFileSync(resolve(keyPath)) : undefined,
    },
  });
}

const dispatcher = buildDispatcher();

export const bankClient = new SecureBankClient({
  baseUrl: process.env.BANK_API_BASE_URL || "https://sandbox.bank.example.com", // default sandbox
  clientId: process.env.BANK_API_CLIENT_ID || "",
  clientSecret: process.env.BANK_API_CLIENT_SECRET || "",
  defaultDebitAccount: process.env.BANK_API_DEFAULT_DEBIT_ACCOUNT,
  dispatcher,
  paytoBaseUrl: process.env.PAYTO_API_BASE_URL,
  paytoClientId: process.env.PAYTO_CLIENT_ID,
  paytoClientSecret: process.env.PAYTO_CLIENT_SECRET,
  paytoScope: process.env.PAYTO_SCOPE,
});

export { dollarsToCents };
