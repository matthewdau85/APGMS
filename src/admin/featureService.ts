import { Pool, PoolClient } from "pg";
import { appendAudit } from "../audit/appendOnly";

export type FeatureKey = "SIM_INBOUND" | "SIM_OUTBOUND" | "DRY_RUN" | "SHADOW_ONLY" | "APP_MODE";

type FeatureValue = boolean | string | number | Record<string, unknown> | null;

export interface Actor {
  id: string;
  role: string;
  mfaVerified?: boolean;
}

export interface SecondApprover {
  id: string;
  approved: boolean;
}

export interface SetFeatureFlagOptions {
  key: FeatureKey;
  value: FeatureValue;
  actor: Actor;
  requestId: string;
  reason?: string;
  secondApprover?: SecondApprover;
  mfaCode?: string;
}

const pool = new Pool();

export const FEATURE_FLAG_KEYS: FeatureKey[] = [
  "SIM_INBOUND",
  "SIM_OUTBOUND",
  "DRY_RUN",
  "SHADOW_ONLY",
  "APP_MODE",
];

const DEFAULT_VALUES: Record<FeatureKey, FeatureValue> = {
  SIM_INBOUND: true,
  SIM_OUTBOUND: true,
  DRY_RUN: true,
  SHADOW_ONLY: false,
  APP_MODE: "sandbox",
};

async function withClient<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function getFeatureFlags(): Promise<Record<FeatureKey, FeatureValue>> {
  return withClient(async client => {
    const { rows } = await client.query<{ key: FeatureKey; value: FeatureValue }>(
      "SELECT key, value FROM feature_flags"
    );

    const flags = { ...DEFAULT_VALUES } as Record<FeatureKey, FeatureValue>;
    for (const row of rows) {
      if (FEATURE_FLAG_KEYS.includes(row.key)) {
        flags[row.key] = row.value;
      }
    }
    return flags;
  });
}

function ensureAdmin(actor: Actor) {
  if (actor.role !== "admin") {
    throw Object.assign(new Error("FORBIDDEN"), { status: 403 });
  }
}

function assertMfa(options: SetFeatureFlagOptions) {
  if (!options.actor.mfaVerified) {
    throw Object.assign(new Error("MFA_REQUIRED"), { status: 428 });
  }
  if (!options.mfaCode) {
    throw Object.assign(new Error("MFA_CODE_REQUIRED"), { status: 400 });
  }
  if (!options.secondApprover || !options.secondApprover.approved) {
    throw Object.assign(new Error("APPROVAL_REQUIRED"), { status: 428 });
  }
  if (options.secondApprover.id === options.actor.id) {
    throw Object.assign(new Error("APPROVER_MUST_DIFFER"), { status: 400 });
  }
}

async function recordApproval(client: PoolClient, options: SetFeatureFlagOptions) {
  const approvalStatus = options.secondApprover?.approved ? "APPROVED" : "PENDING";
  await client.query(
    `INSERT INTO approvals (request_id, flag_key, requested_by, approved_by, approved_at, status)
     VALUES ($1,$2,$3,$4, CASE WHEN $5 = 'APPROVED' THEN NOW() ELSE NULL END, $5)
     ON CONFLICT (request_id) DO UPDATE
     SET flag_key = EXCLUDED.flag_key,
         requested_by = EXCLUDED.requested_by,
         approved_by = EXCLUDED.approved_by,
         approved_at = CASE WHEN EXCLUDED.status = 'APPROVED' THEN NOW() ELSE approvals.approved_at END,
         status = EXCLUDED.status`,
    [
      options.requestId,
      options.key,
      options.actor.id,
      options.secondApprover?.id ?? null,
      approvalStatus,
    ]
  );
}

export async function setFeatureFlag(options: SetFeatureFlagOptions) {
  ensureAdmin(options.actor);
  return withClient(async client => {
    await client.query("BEGIN");
    try {
      const existing = await client.query<{ value: FeatureValue }>(
        "SELECT value FROM feature_flags WHERE key = $1 FOR UPDATE",
        [options.key]
      );
      const oldValue = existing.rows[0]?.value ?? DEFAULT_VALUES[options.key];

      if (options.key === "APP_MODE" && options.value === "real") {
        assertMfa(options);
        await recordApproval(client, options);
      }

      const upsert = await client.query<{ value: FeatureValue }>(
        `INSERT INTO feature_flags(key, value, updated_by, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = EXCLUDED.updated_at
         RETURNING value`,
        [options.key, options.value, options.actor.id]
      );

      await appendAudit({
        who: options.actor.id,
        what: `feature:${options.key}`,
        old: oldValue,
        new: upsert.rows[0].value,
        requestId: options.requestId,
      });

      await client.query("COMMIT");
      return upsert.rows[0].value;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });
}
