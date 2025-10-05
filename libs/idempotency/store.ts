import { Pool, PoolClient } from "pg";
import { createHash } from "crypto";

export type IdempotencyStatus = "pending" | "applied" | "failed";

export type CachedResponse = {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  contentType: string | null;
};

export type EnsureOutcome =
  | { outcome: "acquired"; wasCreated: boolean; ttlSecs: number }
  | { outcome: "replay"; cached: CachedResponse }
  | { outcome: "failed"; failureCause: string }
  | { outcome: "in_progress" };

export interface EnsureOptions {
  ttlSecs?: number;
  allowExistingPending?: boolean;
}

export interface CompleteOptions {
  statusCode: number;
  body: any;
  headers?: Record<string, string | number | string[]>;
  contentType?: string | null;
  ttlSecs?: number;
}

const DEFAULT_TTL = Number(process.env.PROTO_IDEMPOTENCY_TTL_SECS || "86400");

function toHeaders(input?: Record<string, string | number | string[]>): Record<string, string> {
  if (!input) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      result[key.toLowerCase()] = value.join(", ");
    } else {
      result[key.toLowerCase()] = String(value);
    }
  }
  return result;
}

export class IdempotencyStore {
  private readonly pool: Pool;
  private readonly defaultTtl: number;

  constructor(pool?: Pool, defaultTtlSecs: number = DEFAULT_TTL) {
    this.pool = pool ?? new Pool();
    this.defaultTtl = defaultTtlSecs;
  }

  get defaultTtlSecs() {
    return this.defaultTtl;
  }

  private stableStringify(value: any): string {
    if (value === null || value === undefined) return "null";
    if (typeof value !== "object") {
      if (typeof value === "bigint") return value.toString();
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableStringify(entry)).join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    const entries = keys
      .map((key) => `${JSON.stringify(key)}:${this.stableStringify((value as any)[key])}`)
      .join(",");
    return `{${entries}}`;
  }

  private async run<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async ensure(key: string, options: EnsureOptions = {}): Promise<EnsureOutcome> {
    const ttlSecs = options.ttlSecs ?? this.defaultTtl;
    return this.run(async (client) => {
      try {
        await client.query(
          `insert into idempotency_keys (id, first_seen_at, status, response_hash, failure_cause, ttl_secs)
           values ($1, now(), 'pending', null, null, $2)`,
          [key, ttlSecs]
        );
        return { outcome: "acquired", wasCreated: true, ttlSecs } as EnsureOutcome;
      } catch (err: any) {
        if (err?.code !== "23505") throw err;
      }

      const { rows } = await client.query<{ status: IdempotencyStatus; response_hash: string | null; failure_cause: string | null }>(
        `select status, response_hash, failure_cause from idempotency_keys where id=$1`,
        [key]
      );
      if (!rows.length) {
        // Extremely unlikely, but treat as new owner by re-inserting.
        await client.query(
          `insert into idempotency_keys (id, first_seen_at, status, response_hash, failure_cause, ttl_secs)
           values ($1, now(), 'pending', null, null, $2)
           on conflict (id) do nothing`,
          [key, ttlSecs]
        );
        return { outcome: "acquired", wasCreated: true, ttlSecs } as EnsureOutcome;
      }

      const record = rows[0];
      if (record.status === "applied" && record.response_hash) {
        const cached = await this.getCachedResponse(record.response_hash, client);
        if (cached) return { outcome: "replay", cached } as EnsureOutcome;
      }
      if (record.status === "failed") {
        return { outcome: "failed", failureCause: record.failure_cause || "Idempotency key failed" } as EnsureOutcome;
      }
      if (options.allowExistingPending) {
        return { outcome: "acquired", wasCreated: false, ttlSecs } as EnsureOutcome;
      }
      return { outcome: "in_progress" } as EnsureOutcome;
    });
  }

  async markApplied(key: string, data: CompleteOptions): Promise<void> {
    const ttlSecs = data.ttlSecs ?? this.defaultTtl;
    await this.run(async (client) => {
      await client.query("begin");
      try {
        const canonical = this.stableStringify(data.body);
        const hash = createHash("sha256").update(canonical).digest("hex");
        const headers = toHeaders(data.headers);
        if (data.contentType && !headers["content-type"]) {
          headers["content-type"] = data.contentType;
        }
        await client.query(
          `insert into idempotency_responses(hash, status_code, body, content_type, headers, created_at)
           values ($1,$2,$3,$4,$5,now())
           on conflict (hash) do update
             set status_code=excluded.status_code,
                 body=excluded.body,
                 content_type=excluded.content_type,
                 headers=excluded.headers,
                 created_at=now()`,
          [hash, data.statusCode, JSON.stringify(data.body ?? null), data.contentType ?? headers["content-type"] ?? null, JSON.stringify(headers)]
        );
        await client.query(
          `update idempotency_keys
             set status='applied', response_hash=$2, failure_cause=null, ttl_secs=$3
           where id=$1`,
          [key, hash, ttlSecs]
        );
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    });
  }

  async markFailed(key: string, failureCause: string): Promise<void> {
    await this.pool.query(
      `update idempotency_keys
         set status='failed', failure_cause=$2
       where id=$1`,
      [key, failureCause]
    );
  }

  async getCachedResponse(hash: string, client?: PoolClient): Promise<CachedResponse | null> {
    const runner = client ? async (fn: (client: PoolClient) => Promise<CachedResponse | null>) => fn(client) : this.run.bind(this);
    return runner(async (conn) => {
      const { rows } = await conn.query<{ status_code: number; body: any; content_type: string | null; headers: Record<string, string> | null }>(
        `select status_code, body, content_type, headers from idempotency_responses where hash=$1`,
        [hash]
      );
      if (!rows.length) return null;
      const row = rows[0];
      const headers = (row.headers as any) || {};
      return {
        statusCode: row.status_code,
        body: typeof row.body === "string" ? JSON.parse(row.body) : row.body,
        headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)])),
        contentType: row.content_type,
      };
    });
  }

  async purgeExpired(now: Date = new Date()): Promise<{ deleted: number }> {
    const { rows } = await this.pool.query<{ response_hash: string | null }>(
      `delete from idempotency_keys
         where (first_seen_at + (ttl_secs::text || ' seconds')::interval) < $1
       returning response_hash`,
      [now]
    );
    const hashes = rows.map((r) => r.response_hash).filter((hash): hash is string => Boolean(hash));
    if (hashes.length) {
      await this.pool.query(
        `delete from idempotency_responses
           where hash = any($1::text[])`,
        [hashes]
      );
    }
    return { deleted: rows.length };
  }
}

let defaultStore: IdempotencyStore | null = null;

export function getDefaultIdempotencyStore(): IdempotencyStore {
  if (!defaultStore) {
    defaultStore = new IdempotencyStore();
  }
  return defaultStore;
}
