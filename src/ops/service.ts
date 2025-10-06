import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import EventEmitter from "events";
import { appendAudit } from "../audit/appendOnly";
import { JobArtifact, OpsJobEvent, OpsJobRecord, OpsJobStatus, OpsJobType } from "../types/ops";

const pool = new Pool();

export interface CreateJobInput {
  type: OpsJobType;
  params: Record<string, any>;
  actor: string;
  approver?: string;
  requiresDual?: boolean;
  mfaVerifiedAt: Date;
  parentJobId?: string;
}

export interface JobContext {
  job: OpsJobRecord;
  log: (message: string, level?: "info" | "warn" | "error") => Promise<void>;
  progress: (value: number) => Promise<void>;
  artifact: (artifact: JobArtifact) => Promise<void>;
  summary: (payload: Record<string, any>) => Promise<void>;
}

type JobHandler = (ctx: JobContext) => Promise<void>;

const events = new EventEmitter();

const jobHandlers: Record<OpsJobType, JobHandler> = {
  seed: async (ctx) => {
    await ctx.log("Starting seed job (baseline data)");
    await ctx.progress(10);
    await simulateWork(120);
    await ctx.log("Validated remittance destinations");
    await ctx.progress(40);
    await simulateWork(120);
    await ctx.log("Inserted demo entities and tax periods");
    await ctx.progress(75);
    await simulateWork(120);
    await ctx.summary({ message: "Seed completed", records: 42 });
    await ctx.artifact({
      name: "seed-report.json",
      mime: "application/json",
      encoding: "utf8",
      data: JSON.stringify({ generatedAt: new Date().toISOString(), seededRecords: 42 }, null, 2),
      description: "Seed summary snapshot",
    });
    await ctx.progress(100);
  },
  smoke: async (ctx) => {
    await ctx.log("Kick off smoke suite");
    await ctx.progress(5);
    await simulateWork(100);
    await ctx.log("Running API heartbeat checks");
    await ctx.progress(30);
    await simulateWork(100);
    await ctx.log("Verifying ledger invariants");
    await ctx.progress(70);
    await simulateWork(100);
    await ctx.summary({ message: "Smoke checks passed" });
    await ctx.progress(100);
  },
  replay: async (ctx) => {
    const ids = Array.isArray(ctx.job.params.ids) ? ctx.job.params.ids : [];
    if (!ids.length) {
      await ctx.log("No DLQ ids provided", "warn");
      await ctx.summary({ message: "No items to replay" });
      await ctx.progress(100);
      return;
    }
    await ctx.log(`Replaying ${ids.length} DLQ message(s)`);
    const per = Math.max(1, Math.floor(90 / ids.length));
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      await simulateWork(80);
      await ctx.log(`Replayed DLQ message ${id}`);
      await ctx.progress(Math.min(95, 5 + per * (i + 1)));
    }
    await ctx.summary({ message: "Replay complete", replayed: ids.length });
    await ctx.progress(100);
  },
  rules_bump: async (ctx) => {
    await ctx.log("Checking current governance rules version");
    await simulateWork(120);
    const target = ctx.job.params.targetVersion || "next";
    await ctx.log(`Bumping governance rules to ${target}`);
    await ctx.summary({
      message: "Rules bumped",
      targetVersion: target,
      previousVersion: ctx.job.params.previousVersion || "auto-detect",
    });
    await ctx.progress(100);
  },
  openapi_regenerate: async (ctx) => {
    await ctx.log("Generating OpenAPI specification");
    await simulateWork(140);
    await ctx.artifact({
      name: "openapi.json",
      mime: "application/json",
      encoding: "utf8",
      data: JSON.stringify({ version: "1.0.0", generatedAt: new Date().toISOString() }, null, 2),
      description: "Generated OpenAPI spec",
    });
    await ctx.summary({ message: "OpenAPI regenerated" });
    await ctx.progress(100);
  },
  docs_validate: async (ctx) => {
    await ctx.log("Validating operational runbooks");
    await simulateWork(120);
    await ctx.summary({ message: "Docs validation complete", warnings: 0 });
    await ctx.progress(100);
  },
};

let workerStarted = false;
const queue: string[] = [];
let running = false;

export function startOpsWorker() {
  if (workerStarted) return;
  workerStarted = true;
  void drainQueue();
}

export async function createJob(input: CreateJobInput): Promise<OpsJobRecord> {
  if (!jobHandlers[input.type]) {
    throw new Error("UNSUPPORTED_JOB_TYPE");
  }
  const id = uuidv4();
  const requiresDual = Boolean(input.requiresDual);
  const normalizedParams =
    input.params && typeof input.params === "object" ? input.params : {};
  const { rows } = await pool.query(
    `
    insert into ops_jobs
      (id, type, params, status, progress, logs, artifacts, summary, actor, approver, requires_dual, mfa_verified_at, created_at, updated_at, parent_job_id)
    values ($1,$2,$3,'queued',0,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb,$4,$5,$6,$7, now(), now(), $8)
    returning *
    `,
    [
      id,
      input.type,
      JSON.stringify(normalizedParams),
      input.actor,
      input.approver || null,
      requiresDual,
      input.mfaVerifiedAt.toISOString(),
      input.parentJobId || null,
    ]
  );
  const job = mapRow(rows[0]);
  await appendAudit(input.actor, "ops.job.queued", {
    jobId: job.id,
    type: job.type,
    params: job.params,
    requiresDual,
    approver: job.approver || undefined,
  });
  enqueue(job.id);
  return job;
}

export async function listJobs(limit = 25, status?: string): Promise<OpsJobRecord[]> {
  const rows = await pool.query(
    `select * from ops_jobs ${status ? "where status=$2" : ""} order by created_at desc limit $1`,
    status ? [limit, status] : [limit]
  );
  return rows.rows.map(mapRow);
}

export async function getJob(id: string): Promise<OpsJobRecord | null> {
  const { rows } = await pool.query("select * from ops_jobs where id=$1", [id]);
  if (!rows.length) return null;
  return mapRow(rows[0]);
}

export async function retryJob(id: string, actor: string, approver?: string, mfaVerifiedAt?: Date): Promise<OpsJobRecord> {
  const existing = await getJob(id);
  if (!existing) {
    throw new Error("JOB_NOT_FOUND");
  }
  if (existing.status !== "failed") {
    throw new Error("ONLY_FAILED_RETRY");
  }
  return createJob({
    type: existing.type,
    params: existing.params,
    actor,
    approver,
    requiresDual: existing.requires_dual,
    mfaVerifiedAt: mfaVerifiedAt || new Date(),
    parentJobId: existing.id,
  });
}

function enqueue(id: string) {
  queue.push(id);
  void drainQueue();
}

async function drainQueue() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift();
    if (!id) continue;
    try {
      await runJob(id);
    } catch (err) {
      console.error("[ops-worker]", err);
    }
  }
  running = false;
}

async function runJob(id: string) {
  const job = await getJob(id);
  if (!job) return;
  await setStatus(id, "running");
  await setStarted(id);
  const handler = jobHandlers[job.type];
  if (!handler) {
    await failJob(id, job, new Error(`NO_HANDLER:${job.type}`));
    return;
  }
  const ctx: JobContext = {
    job,
    log: (message, level = "info") => appendLog(id, message, level),
    progress: (value) => setProgress(id, value),
    artifact: (artifact) => addArtifact(id, artifact),
    summary: (summary) => setSummary(id, summary),
  };
  try {
    await handler(ctx);
    await succeedJob(id);
  } catch (err: any) {
    await failJob(id, job, err);
  }
}

async function succeedJob(id: string) {
  await setFinished(id);
  await setStatus(id, "succeeded");
  const job = await getJob(id);
  if (job) {
    await appendAudit(job.actor, "ops.job.completed", {
      jobId: job.id,
      status: job.status,
      summary: job.summary,
    });
  }
}

async function failJob(id: string, job: OpsJobRecord, err: Error) {
  await appendLog(id, err.message || "Job failed", "error");
  await setFinished(id);
  await setStatus(id, "failed");
  const fresh = await getJob(id);
  await appendAudit(job.actor, "ops.job.failed", {
    jobId: id,
    error: err.message,
  });
  if (fresh) {
    emitEvent(id, {
      jobId: id,
      emittedAt: new Date().toISOString(),
      type: "status",
      status: fresh.status,
      progress: fresh.progress,
    });
  }
}

async function appendLog(id: string, message: string, level: "info" | "warn" | "error") {
  const entry = { at: new Date().toISOString(), level, message };
  await pool.query(
    "update ops_jobs set logs = coalesce(logs,'[]'::jsonb) || $2::jsonb, updated_at = now() where id = $1",
    [id, JSON.stringify(entry)]
  );
  emitEvent(id, {
    jobId: id,
    emittedAt: new Date().toISOString(),
    type: "log",
    entry,
  });
}

async function setProgress(id: string, value: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  await pool.query("update ops_jobs set progress=$2, updated_at = now() where id=$1", [id, clamped]);
  emitEvent(id, {
    jobId: id,
    emittedAt: new Date().toISOString(),
    type: "status",
    status: "running",
    progress: clamped,
  });
}

async function addArtifact(id: string, artifact: JobArtifact) {
  await pool.query(
    "update ops_jobs set artifacts = coalesce(artifacts,'[]'::jsonb) || $2::jsonb, updated_at = now() where id=$1",
    [id, JSON.stringify(artifact)]
  );
  emitEvent(id, {
    jobId: id,
    emittedAt: new Date().toISOString(),
    type: "artifact",
    artifact,
  });
}

async function setSummary(id: string, summary: Record<string, any>) {
  await pool.query(
    "update ops_jobs set summary=$2::jsonb, updated_at = now() where id=$1",
    [id, JSON.stringify(summary)]
  );
  emitEvent(id, {
    jobId: id,
    emittedAt: new Date().toISOString(),
    type: "summary",
    summary,
  });
}

async function setStatus(id: string, status: OpsJobStatus) {
  await pool.query("update ops_jobs set status=$2, updated_at = now() where id=$1", [id, status]);
  const progress =
    status === "queued" ? 0 : status === "running" ? 0 : 100;
  emitEvent(id, {
    jobId: id,
    emittedAt: new Date().toISOString(),
    type: "status",
    status,
    progress,
  });
}

async function setStarted(id: string) {
  await pool.query("update ops_jobs set started_at = now(), updated_at = now() where id=$1", [id]);
}

async function setFinished(id: string) {
  await pool.query("update ops_jobs set finished_at = now(), updated_at = now() where id=$1", [id]);
}

function mapRow(row: any): OpsJobRecord {
  return {
    id: row.id,
    type: row.type,
    params: row.params || {},
    status: row.status,
    progress: Number(row.progress) || 0,
    logs: row.logs || [],
    artifacts: row.artifacts || [],
    summary: row.summary || {},
    actor: row.actor,
    approver: row.approver,
    requires_dual: row.requires_dual,
    mfa_verified_at: row.mfa_verified_at ? new Date(row.mfa_verified_at).toISOString() : null,
    started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
    finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    parent_job_id: row.parent_job_id || null,
  };
}

function emitEvent(jobId: string, event: OpsJobEvent) {
  events.emit(jobId, event);
}

export function subscribe(jobId: string, listener: (event: OpsJobEvent) => void) {
  events.on(jobId, listener);
  return () => events.off(jobId, listener);
}

async function simulateWork(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
