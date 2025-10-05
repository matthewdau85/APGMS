import assert from "node:assert/strict";
import { IdempotencyStore } from "../libs/idempotency/store";

type KeyRecord = {
  id: string;
  first_seen_at: Date;
  status: "pending" | "applied" | "failed";
  response_hash: string | null;
  failure_cause: string | null;
  ttl_secs: number;
};

type ResponseRecord = {
  hash: string;
  status_code: number;
  body: any;
  content_type: string | null;
  headers: Record<string, string>;
  created_at: Date;
};

class MemoryState {
  keys = new Map<string, KeyRecord>();
  responses = new Map<string, ResponseRecord>();
}

class MemoryClient {
  constructor(private state: MemoryState) {}

  async query(text: string, params: any[] = []) {
    const sql = text.trim().toLowerCase();
    if (sql.startsWith("insert into idempotency_keys") && !sql.includes("on conflict")) {
      const [id, ttl] = params;
      if (this.state.keys.has(id)) {
        const err: any = new Error("duplicate key");
        err.code = "23505";
        throw err;
      }
      this.state.keys.set(id, {
        id,
        first_seen_at: new Date(),
        status: "pending",
        response_hash: null,
        failure_cause: null,
        ttl_secs: Number(ttl) || 0,
      });
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("insert into idempotency_keys") && sql.includes("on conflict")) {
      const [id, ttl] = params;
      if (!this.state.keys.has(id)) {
        this.state.keys.set(id, {
          id,
          first_seen_at: new Date(),
          status: "pending",
          response_hash: null,
          failure_cause: null,
          ttl_secs: Number(ttl) || 0,
        });
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("select status, response_hash")) {
      const [id] = params;
      const record = this.state.keys.get(id);
      return { rows: record ? [record] : [], rowCount: record ? 1 : 0 } as any;
    }
    if (sql.startsWith("insert into idempotency_responses")) {
      const [hash, statusCode, body, contentType, headers] = params;
      const parsedHeaders = JSON.parse(headers ?? "{}");
      this.state.responses.set(hash, {
        hash,
        status_code: statusCode,
        body: JSON.parse(body ?? "null"),
        content_type: contentType ?? null,
        headers: parsedHeaders,
        created_at: new Date(),
      });
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("update idempotency_keys")) {
      const [id, hash, ttl] = params;
      const record = this.state.keys.get(id);
      if (record) {
        record.status = "applied";
        record.response_hash = hash;
        record.failure_cause = null;
        record.ttl_secs = Number(ttl) || record.ttl_secs;
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("select status_code, body")) {
      const [hash] = params;
      const record = this.state.responses.get(hash);
      return record
        ? { rows: [{ status_code: record.status_code, body: JSON.stringify(record.body), content_type: record.content_type, headers: record.headers }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("update idempotency_keys set status='failed'")) {
      const [failure, id] = params;
      const record = this.state.keys.get(id);
      if (record) {
        record.status = "failed";
        record.failure_cause = failure;
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("delete from idempotency_keys")) {
      const deleted: Array<{ response_hash: string | null }> = [];
      for (const [id, record] of this.state.keys.entries()) {
        const expiry = new Date(record.first_seen_at.getTime() + record.ttl_secs * 1000);
        if (expiry < new Date(params[0])) {
          this.state.keys.delete(id);
          deleted.push({ response_hash: record.response_hash });
        }
      }
      return { rows: deleted, rowCount: deleted.length };
    }
    if (sql.startsWith("delete from idempotency_responses")) {
      const hashes: string[] = params[0];
      hashes.forEach((hash) => this.state.responses.delete(hash));
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  release() {}
}

class MemoryPool {
  private state = new MemoryState();

  async connect() {
    return new MemoryClient(this.state);
  }

  async query(text: string, params?: any[]) {
    const client = await this.connect();
    return client.query(text, params);
  }

  async end() {}
}

async function main() {
  const pool = new MemoryPool() as unknown as any;
  const store = new IdempotencyStore(pool, 60);
  const key = "ABN:12345678901:BAS:2024Q1:PAYMENT:-10000";

  const raceResults = await Promise.all(
    Array.from({ length: 10 }, () => store.ensure(key))
  );

  const acquired = raceResults.filter((r: any) => r.outcome === "acquired" && r.wasCreated).length;
  const inProgress = raceResults.filter((r: any) => r.outcome === "in_progress").length;

  assert.equal(acquired, 1, "exactly one caller should acquire the key");
  assert.equal(inProgress, 9, "other callers should see in-progress state");

  await store.markApplied(key, {
    statusCode: 200,
    body: { ok: true },
    headers: { "content-type": "application/json" },
  });

  const replay = await store.ensure(key);
  assert.equal((replay as any).outcome, "replay", "subsequent calls should replay");
  assert.deepEqual((replay as any).cached.body, { ok: true });

  console.log("idempotency race test passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
