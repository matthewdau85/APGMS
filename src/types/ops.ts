export type OpsJobType =
  | "seed"
  | "smoke"
  | "replay"
  | "rules_bump"
  | "openapi_regenerate"
  | "docs_validate";

export type OpsJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export interface JobArtifact {
  name: string;
  mime: string;
  data: string;
  encoding?: "utf8" | "base64";
  description?: string;
}

export interface OpsJobRecord {
  id: string;
  type: OpsJobType;
  params: Record<string, any>;
  status: OpsJobStatus;
  progress: number;
  logs: Array<{ at: string; level: "info" | "warn" | "error"; message: string }>;
  artifacts: JobArtifact[];
  summary: Record<string, any>;
  actor: string;
  approver?: string | null;
  requires_dual: boolean;
  mfa_verified_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
  parent_job_id?: string | null;
}

export interface OpsJobEventBase {
  jobId: string;
  emittedAt: string;
}

export interface OpsJobLogEvent extends OpsJobEventBase {
  type: "log";
  entry: { at: string; level: "info" | "warn" | "error"; message: string };
}

export interface OpsJobStatusEvent extends OpsJobEventBase {
  type: "status";
  status: OpsJobStatus;
  progress: number;
}

export interface OpsJobArtifactEvent extends OpsJobEventBase {
  type: "artifact";
  artifact: JobArtifact;
}

export interface OpsJobSummaryEvent extends OpsJobEventBase {
  type: "summary";
  summary: Record<string, any>;
}

export interface OpsJobBootstrapEvent extends OpsJobEventBase {
  type: "bootstrap";
  job: OpsJobRecord;
}

export type OpsJobEvent =
  | OpsJobLogEvent
  | OpsJobStatusEvent
  | OpsJobArtifactEvent
  | OpsJobSummaryEvent
  | OpsJobBootstrapEvent;
