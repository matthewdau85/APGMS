import pg from "pg";
import axios from "axios";

export type Dest = { bsb?: string; acct?: string; bpay_biller?: string; crn?: string };

const { Pool } = pg;

type Rail = "BPAY" | "EFT";

type NormalizedDest = {
  rail: Rail;
  reference: string;
  bpay_biller?: string;
  bsb?: string;
  acct?: string;
};

export interface AllowlistProvider {
  isAllowlisted(abn: string, dest: NormalizedDest): Promise<boolean>;
}

let provider: AllowlistProvider | null = null;

function sanitizeNumeric(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function sanitizeReference(value: string) {
  return value.replace(/\s+/g, "");
}

function normalizeDest(dest: Dest): NormalizedDest | null {
  if (dest.bpay_biller && dest.crn) {
    return {
      rail: "BPAY",
      reference: sanitizeReference(dest.crn),
      bpay_biller: sanitizeReference(dest.bpay_biller)
    };
  }
  if (dest.bsb && dest.acct) {
    return {
      rail: "EFT",
      reference: sanitizeReference(dest.acct),
      bsb: sanitizeNumeric(dest.bsb),
      acct: sanitizeReference(dest.acct)
    };
  }
  return null;
}

class DatabaseAllowlistProvider implements AllowlistProvider {
  private pool: pg.Pool;

  constructor() {
    const sslMode = process.env.PGSSLMODE;
    const ssl = sslMode === "require" ? { rejectUnauthorized: false } : undefined;
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl
    });
  }

  async isAllowlisted(abn: string, dest: NormalizedDest): Promise<boolean> {
    if (!abn) return false;
    if (dest.rail === "BPAY") {
      const { rows } = await this.pool.query(
        `SELECT 1
         FROM remittance_destinations
         WHERE abn = $1
           AND rail = 'BPAY'
           AND reference = $2
         LIMIT 1`,
        [abn, dest.reference]
      );
      return rows.length > 0;
    }

    if (!dest.bsb || !dest.acct) return false;
    const { rows } = await this.pool.query(
      `SELECT 1
       FROM remittance_destinations
       WHERE abn = $1
         AND rail = 'EFT'
         AND regexp_replace(account_bsb, '[^0-9]', '', 'g') = $2
         AND regexp_replace(account_number, '\\s', '', 'g') = $3
       LIMIT 1`,
      [abn, dest.bsb, dest.acct]
    );
    return rows.length > 0;
  }
}

type RegistryRow = {
  abn: string;
  rail: Rail;
  reference?: string;
  account_bsb?: string;
  account_number?: string;
  bpay_biller?: string;
};

class HttpAllowlistProvider implements AllowlistProvider {
  private cache: RegistryRow[] = [];
  private fetchedAt = 0;
  private readonly ttlMs: number;

  constructor(private readonly url: string) {
    this.ttlMs = Number(process.env.ALLOWLIST_REGISTRY_TTL_MS || "60000");
  }

  private async refresh() {
    if (Date.now() - this.fetchedAt < this.ttlMs && this.cache.length) return;
    const timeout = Number(process.env.ALLOWLIST_REGISTRY_TIMEOUT_MS || "5000");
    const res = await axios.get(this.url, { timeout });
    const data = Array.isArray(res.data) ? res.data : [];
    this.cache = data
      .filter((row: any) => row && typeof row === "object")
      .map((row: any) => {
        const rail = String(row.rail || "").toUpperCase();
        if (rail !== "BPAY" && rail !== "EFT") return null;
        return {
          abn: String(row.abn || "").trim(),
          rail: rail as Rail,
          reference: row.reference ? sanitizeReference(String(row.reference)) : undefined,
          account_bsb: row.account_bsb ? sanitizeNumeric(String(row.account_bsb)) : undefined,
          account_number: row.account_number ? sanitizeReference(String(row.account_number)) : undefined,
          bpay_biller: row.bpay_biller ? sanitizeReference(String(row.bpay_biller)) : undefined
        } as RegistryRow | null;
      })
      .filter((row: RegistryRow | null): row is RegistryRow => !!row);
    this.fetchedAt = Date.now();
  }

  async isAllowlisted(abn: string, dest: NormalizedDest): Promise<boolean> {
    await this.refresh();
    return this.cache.some((row) => {
      if (!row.abn || row.abn !== abn || row.rail !== dest.rail) return false;
      if (dest.rail === "BPAY") {
        return !!row.reference && row.reference === dest.reference && (!row.bpay_biller || row.bpay_biller === dest.bpay_biller);
      }
      return !!row.account_bsb && !!row.account_number && row.account_bsb === dest.bsb && row.account_number === dest.acct;
    });
  }
}

function getProvider(): AllowlistProvider {
  if (provider) return provider;
  const registryUrl = process.env.REMITTANCE_REGISTRY_URL || process.env.ALLOWLIST_REGISTRY_URL;
  provider = registryUrl ? new HttpAllowlistProvider(registryUrl) : new DatabaseAllowlistProvider();
  return provider;
}

export function setAllowlistProvider(p: AllowlistProvider | null) {
  provider = p;
}

export async function isAllowlisted(abn: string, dest: Dest): Promise<boolean> {
  if (!dest) return false;
  const normalized = normalizeDest(dest);
  if (!normalized) return false;
  const prov = getProvider();
  return prov.isAllowlisted(abn.trim(), normalized);
}
