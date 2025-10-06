import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../index.js";
import { canonicalJson, sha256Hex } from "../../utils/crypto.js";

const BSB_REGEX = /^\d{6}$/;
const ACCOUNT_REGEX = /^\d{5,9}$/;
const CRN_REGEX = /^[A-Za-z0-9]{2,20}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GLOBAL_KEY = "__apgms_mock_banking";

type Destination = {
  bpay_biller?: string;
  crn?: string;
  bsb?: string;
  acct?: string;
};

type EftBpayParams = {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  destination: Destination;
  idempotencyKey: string;
};

type SettlementRow = {
  provider_ref: string;
  amount_cents: number;
  paid_at: Date;
  meta: any;
};

type Mandate = {
  id: string;
  abn: string;
  periodId: string;
  cap_cents: number;
  status: "pending" | "active" | "cancelled";
  created_at: string;
  verified_at?: string;
  cancelled_at?: string;
};

export class MockBankingError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "MockBankingError";
    this.status = status;
    this.code = code;
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clampNumber(value: number, fallback: number) {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function toUuid(input: string): string {
  if (UUID_REGEX.test(input)) {
    return input.toLowerCase();
  }
  const hash = createHash("sha1").update(input).digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC4122
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16).padStart(2, "0");
    hex.push(h);
  }
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

function parseFloatEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function parseRail(dest: Destination): "EFT" | "BPAY" {
  if (dest.bpay_biller) return "BPAY";
  return "EFT";
}

function normaliseDestination(dest: Destination): Destination {
  const trimmed: Destination = {};
  if (dest.bpay_biller) trimmed.bpay_biller = String(dest.bpay_biller).trim();
  if (dest.crn) trimmed.crn = String(dest.crn).trim();
  if (dest.bsb) trimmed.bsb = String(dest.bsb).trim();
  if (dest.acct) trimmed.acct = String(dest.acct).trim();
  return trimmed;
}

function validateDestination(dest: Destination) {
  const d = normaliseDestination(dest);
  const isBpay = !!d.bpay_biller || !!d.crn;
  const isEft = !!d.bsb || !!d.acct;

  if (!isBpay && !isEft) {
    throw new MockBankingError("Destination must include EFT or BPAY details", 400);
  }

  if (isBpay) {
    if (!d.crn || !CRN_REGEX.test(d.crn)) {
      throw new MockBankingError("Invalid BPAY CRN", 400);
    }
    if (!d.bpay_biller) {
      throw new MockBankingError("Missing BPAY biller", 400);
    }
  }

  if (isEft) {
    if (!d.bsb || !BSB_REGEX.test(d.bsb)) {
      throw new MockBankingError("Invalid BSB", 400);
    }
    if (!d.acct || !ACCOUNT_REGEX.test(d.acct)) {
      throw new MockBankingError("Invalid account", 400);
    }
  }
}

function payloadHash(idempotencyKey: string, payload: any) {
  const body = canonicalJson(payload);
  return {
    hash: sha256Hex(idempotencyKey + body).slice(0, 16).toUpperCase(),
    canonical: body,
  };
}

async function queryExisting(periodUuid: string, rail: string, idempotencyKey: string) {
  const q = `
    SELECT provider_ref, amount_cents, paid_at, meta
    FROM settlements
    WHERE period_id = $1
      AND rail = $2
      AND meta ->> 'idempotencyKey' = $3
    ORDER BY paid_at DESC
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [periodUuid, rail, idempotencyKey]);
  if (!rows.length) return null;
  return rows[0] as SettlementRow;
}

async function insertSettlement(client: PoolClient | null, values: {
  period_uuid: string;
  rail: "EFT" | "BPAY" | "PAYTO";
  provider_ref: string;
  amount_cents: number;
  paid_at: Date;
  meta: Record<string, any>;
}) {
  const target = client ?? pool;
  const q = `
    INSERT INTO settlements (period_id, rail, provider_ref, amount_cents, paid_at, simulated, meta)
    VALUES ($1,$2,$3,$4,$5,TRUE,$6::jsonb)
    ON CONFLICT (id) DO NOTHING
  `;
  await target.query(q, [
    values.period_uuid,
    values.rail,
    values.provider_ref,
    values.amount_cents,
    values.paid_at,
    JSON.stringify(values.meta),
  ]);
}

function getMandateStore() {
  const g = globalThis as any;
  if (!g.__apgms_mock_mandates) {
    g.__apgms_mock_mandates = new Map<string, Mandate>();
  }
  return g.__apgms_mock_mandates as Map<string, Mandate>;
}

export class MockBanking {
  private mandates: Map<string, Mandate>;

  constructor() {
    this.mandates = getMandateStore();
  }

  private async injectFaults() {
    const p50 = clampNumber(parseFloatEnv("BANK_SIM_P50_MS", 300), 300);
    const p95 = Math.max(p50, clampNumber(parseFloatEnv("BANK_SIM_P95_MS", 1200), 1200));
    const baseDelay = Math.random() < 0.5
      ? Math.random() * p50
      : p50 + Math.random() * (p95 - p50);
    if (baseDelay > 0) {
      await sleep(baseDelay);
    }

    const timeoutRate = clampNumber(parseFloatEnv("BANK_SIM_TIMEOUT_RATE", 0), 0);
    if (timeoutRate > 0 && Math.random() < timeoutRate) {
      const timeoutMs = clampNumber(parseFloatEnv("BANK_SIM_TIMEOUT_MS", 15000), 15000);
      await sleep(timeoutMs);
      throw new MockBankingError("Simulated bank timeout", 504, "ETIMEDOUT");
    }

    const errRate = clampNumber(parseFloatEnv("BANK_SIM_5XX_RATE", 0), 0);
    if (errRate > 0 && Math.random() < errRate) {
      throw new MockBankingError("Simulated bank 5xx", 502);
    }
  }

  private async withFaults<T>(fn: () => Promise<T>): Promise<T> {
    await this.injectFaults();
    return fn();
  }

  async sendEftOrBpay(params: EftBpayParams) {
    const dest = normaliseDestination(params.destination || {});
    validateDestination(dest);

    if (!params.idempotencyKey) {
      throw new MockBankingError("Missing idempotency key", 400);
    }

    const amount = Math.abs(Number(params.amount_cents));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new MockBankingError("Invalid amount", 400);
    }

    const rail = parseRail(dest);
    const periodUuid = toUuid(params.periodId);
    const payload = {
      abn: params.abn,
      taxType: params.taxType,
      periodId: params.periodId,
      amount_cents: amount,
      destination: dest,
    };
    const { hash, canonical } = payloadHash(params.idempotencyKey, payload);
    const providerRef = `SIM-${hash}`;

    return this.withFaults(async () => {
      const existing = await queryExisting(periodUuid, rail, params.idempotencyKey);
      if (existing) {
        const meta = existing.meta || {};
        if (meta.payloadCanonical && meta.payloadCanonical !== canonical) {
          throw new MockBankingError("Idempotency key collision", 409);
        }
        return {
          rail,
          provider_receipt_id: existing.provider_ref,
          provider_ref: existing.provider_ref,
          bank_receipt_hash: sha256Hex(existing.provider_ref),
          transfer_uuid: meta.transferUuid || meta.transfer_uuid || meta.transferUUID || randomUUID(),
          paid_at: existing.paid_at,
          settlement_amount_cents: existing.amount_cents,
          settlement_meta: meta,
        };
      }

      const transferUuid = randomUUID();
      const paidAt = new Date();
      const settlementMeta = {
        idempotencyKey: params.idempotencyKey,
        payloadCanonical: canonical,
        abn: params.abn,
        taxType: params.taxType,
        transferUuid,
        destination: dest,
      };

      await insertSettlement(null, {
        period_uuid: periodUuid,
        rail,
        provider_ref: providerRef,
        amount_cents: amount,
        paid_at: paidAt,
        meta: settlementMeta,
      });

      return {
        rail,
        provider_receipt_id: providerRef,
        provider_ref: providerRef,
        bank_receipt_hash: sha256Hex(providerRef),
        transfer_uuid: transferUuid,
        paid_at: paidAt,
        settlement_amount_cents: amount,
        settlement_meta: settlementMeta,
      };
    });
  }

  async createMandate(abn: string, periodId: string, cap_cents: number) {
    if (!abn || !periodId) {
      throw new MockBankingError("Missing mandate details", 400);
    }
    if (!Number.isFinite(cap_cents) || cap_cents <= 0) {
      throw new MockBankingError("Invalid cap", 400);
    }
    return this.withFaults(async () => {
      const mandate: Mandate = {
        id: `SIM-MAN-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`,
        abn,
        periodId,
        cap_cents: Math.floor(cap_cents),
        status: "pending",
        created_at: new Date().toISOString(),
      };
      this.mandates.set(mandate.id, mandate);
      return { mandate_id: mandate.id, status: mandate.status, created_at: mandate.created_at };
    });
  }

  async verifyMandate(mandate_id: string) {
    return this.withFaults(async () => {
      const mandate = this.mandates.get(mandate_id);
      if (!mandate) throw new MockBankingError("Mandate not found", 404);
      if (mandate.status === "cancelled") throw new MockBankingError("Mandate cancelled", 400);
      mandate.status = "active";
      mandate.verified_at = new Date().toISOString();
      return { mandate_id, status: mandate.status, verified_at: mandate.verified_at };
    });
  }

  async cancelMandate(mandate_id: string) {
    return this.withFaults(async () => {
      const mandate = this.mandates.get(mandate_id);
      if (!mandate) throw new MockBankingError("Mandate not found", 404);
      mandate.status = "cancelled";
      mandate.cancelled_at = new Date().toISOString();
      return { mandate_id, status: mandate.status, cancelled_at: mandate.cancelled_at };
    });
  }

  async debitMandate(mandate_id: string, amount_cents: number, meta: any = {}) {
    if (!Number.isFinite(amount_cents) || amount_cents <= 0) {
      throw new MockBankingError("Invalid debit amount", 400);
    }
    const idempotencyKey = String(meta?.idempotencyKey || meta?.idempotency_key || "");
    if (!idempotencyKey) {
      throw new MockBankingError("Missing PayTo idempotency key", 400);
    }
    return this.withFaults(async () => {
      const mandate = this.mandates.get(mandate_id);
      if (!mandate) throw new MockBankingError("Mandate not found", 404);
      if (mandate.status !== "active") {
        throw new MockBankingError("Mandate not active", 400);
      }
      if (amount_cents > mandate.cap_cents) {
        throw new MockBankingError("Amount exceeds mandate cap", 400);
      }

      const periodUuid = toUuid(meta?.periodId || mandate.periodId);
      const payload = {
        mandate_id,
        amount_cents,
        meta,
      };
      const { hash, canonical } = payloadHash(idempotencyKey, payload);
      const providerRef = `SIM-${hash}`;

      const existing = await queryExisting(periodUuid, "PAYTO", idempotencyKey);
      if (existing) {
        const existingMeta = existing.meta || {};
        if (existingMeta.payloadCanonical && existingMeta.payloadCanonical !== canonical) {
          throw new MockBankingError("Idempotency key collision", 409);
        }
        return {
          mandate_id,
          provider_receipt_id: existing.provider_ref,
          provider_ref: existing.provider_ref,
          bank_receipt_hash: sha256Hex(existing.provider_ref),
          transfer_uuid: existingMeta.transferUuid || randomUUID(),
          paid_at: existing.paid_at,
          settlement_amount_cents: existing.amount_cents,
        };
      }

      const transferUuid = randomUUID();
      const paidAt = new Date();
      const settlementMeta = {
        idempotencyKey,
        payloadCanonical: canonical,
        mandateId: mandate_id,
        transferUuid,
        meta,
      };

      await insertSettlement(null, {
        period_uuid: periodUuid,
        rail: "PAYTO",
        provider_ref: providerRef,
        amount_cents: Math.floor(amount_cents),
        paid_at: paidAt,
        meta: settlementMeta,
      });

      return {
        mandate_id,
        provider_receipt_id: providerRef,
        provider_ref: providerRef,
        bank_receipt_hash: sha256Hex(providerRef),
        transfer_uuid: transferUuid,
        paid_at: paidAt,
        settlement_amount_cents: Math.floor(amount_cents),
      };
    });
  }
}

export function getMockBanking(): MockBanking {
  const g = globalThis as any;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new MockBanking();
  }
  return g[GLOBAL_KEY] as MockBanking;
}
