import React, { useEffect, useMemo, useState } from "react";
import { JobArtifact, OpsJobEvent, OpsJobRecord } from "../types/ops";

const statusLabels: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

const statusOrder = ["running", "queued", "failed", "succeeded"];

function sortJobs(jobs: OpsJobRecord[]): OpsJobRecord[] {
  return [...jobs].sort((a, b) => {
    const aIdx = statusOrder.indexOf(a.status);
    const bIdx = statusOrder.indexOf(b.status);
    if (aIdx !== bIdx) {
      return aIdx - bIdx;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

interface LaunchPayload {
  endpoint: string;
  body?: Record<string, any>;
}

const defaultHeaders = { "Content-Type": "application/json" };

export default function AdminOps() {
  const [jwt, setJwt] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("ops.admin.jwt") || ""
  );
  const [mfa, setMfa] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("ops.admin.mfa") || ""
  );
  const [approver, setApprover] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("ops.admin.approver") || ""
  );
  const [jobs, setJobs] = useState<OpsJobRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedJob, setSelectedJob] = useState<OpsJobRecord | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ops.admin.jwt", jwt);
      localStorage.setItem("ops.admin.mfa", mfa);
      localStorage.setItem("ops.admin.approver", approver);
    }
  }, [jwt, mfa, approver]);

  const headers = useMemo(() => {
    const base: Record<string, string> = { ...defaultHeaders };
    if (jwt) base["Authorization"] = `Bearer ${jwt}`;
    if (mfa) base["X-MFA-Code"] = mfa;
    if (approver) base["X-OPS-Approver"] = approver;
    return base;
  }, [jwt, mfa, approver]);

  const isAuthReady = Boolean(jwt && mfa);

  useEffect(() => {
    if (!isAuthReady) return;
    let cancelled = false;
    async function fetchJobs() {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (statusFilter !== "all") {
          params.set("status", statusFilter);
        }
        const res = await fetch(`/ops/jobs?${params.toString()}`, {
          headers,
        });
        if (!res.ok) {
          throw new Error(`Failed to load jobs (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) {
          setError(null);
          setJobs(sortJobs(data.jobs || []));
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Unable to load jobs");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchJobs();
    const interval = window.setInterval(fetchJobs, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [headers, isAuthReady, statusFilter]);

  async function launchJob(payload: LaunchPayload) {
    if (!isAuthReady) {
      setError("MFA and JWT are required before launching jobs");
      return;
    }
    try {
      setError(null);
      const res = await fetch(payload.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload.body || {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed with status ${res.status}`);
      }
      const job = (await res.json()) as OpsJobRecord;
      setJobs((prev) => sortJobs([job, ...prev.filter((j) => j.id !== job.id)]));
    } catch (err: any) {
      setError(err.message || "Unable to launch job");
    }
  }

  async function handleRetry(job: OpsJobRecord) {
    try {
      const res = await fetch(`/ops/jobs/${job.id}/retry`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Retry failed (${res.status})`);
      }
      const newJob = (await res.json()) as OpsJobRecord;
      setJobs((prev) => sortJobs([newJob, ...prev.filter((j) => j.id !== newJob.id)]));
    } catch (err: any) {
      setError(err.message || "Retry failed");
    }
  }

  function openJob(job: OpsJobRecord) {
    setSelectedJob(job);
    setDetailError(null);
  }

  function updateJobInState(job: OpsJobRecord) {
    setJobs((prev) => {
      const next = prev.map((j) => (j.id === job.id ? job : j));
      const missing = next.every((j) => j.id !== job.id);
      return sortJobs(missing ? [...next, job] : next);
    });
    setSelectedJob((prev) => (prev && prev.id === job.id ? job : prev));
  }

  return (
    <div className="admin-ops">
      <section className="admin-ops__guardrail">
        <h2>Admin Operations</h2>
        <p>
          Secure operational actions for seed, smoke, DLQ replay and governance are available here. All
          requests require an admin JWT and step-up MFA code.
        </p>
        <div className="admin-ops__credentials">
          <label>
            Admin JWT
            <input
              type="text"
              value={jwt}
              onChange={(e) => setJwt(e.target.value)}
              placeholder="Paste admin JWT"
            />
          </label>
          <label>
            MFA Code
            <input
              type="password"
              value={mfa}
              onChange={(e) => setMfa(e.target.value)}
              placeholder="Enter MFA"
            />
          </label>
          <label>
            Second Approver (optional)
            <input
              type="text"
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              placeholder="approver@company"
            />
          </label>
        </div>
        {!isAuthReady && (
          <div className="admin-ops__warning">Provide JWT + MFA to enable operations.</div>
        )}
        {error && <div className="admin-ops__error">{error}</div>}
      </section>

      <JobLauncher disabled={!isAuthReady} onLaunch={launchJob} />

      <section className="admin-ops__jobs">
        <header>
          <h3>Recent Jobs</h3>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
          </select>
        </header>
        {loading && <div className="admin-ops__loading">Loading jobs…</div>}
        <JobList jobs={jobs} onSelect={openJob} onRetry={handleRetry} />
      </section>

      {selectedJob && jwt && mfa && (
        <JobDetailsModal
          job={selectedJob}
          jwt={jwt}
          mfa={mfa}
          approver={approver}
          headers={headers}
          onClose={() => setSelectedJob(null)}
          onJobUpdate={updateJobInState}
          onError={setDetailError}
          error={detailError}
        />
      )}
    </div>
  );
}

function JobLauncher({ disabled, onLaunch }: { disabled: boolean; onLaunch: (payload: LaunchPayload) => void }) {
  const [replayIds, setReplayIds] = useState<string>("");
  const [rulesVersion, setRulesVersion] = useState<string>("");

  const replayList = useMemo(
    () =>
      replayIds
        .split(/[,\s]+/)
        .map((id) => id.trim())
        .filter(Boolean),
    [replayIds]
  );

  return (
    <section className="admin-ops__launchers">
      <h3>Launch Jobs</h3>
      <div className="admin-ops__cards">
        <article className="admin-ops__card">
          <h4>Seed Environment</h4>
          <p>Populate baseline entities, remittance destinations and demo data.</p>
          <button disabled={disabled} onClick={() => onLaunch({ endpoint: "/ops/seed" })}>
            Launch seed job
          </button>
        </article>

        <article className="admin-ops__card">
          <h4>Smoke Test</h4>
          <p>Execute health checks and ledger invariants against the latest build.</p>
          <button disabled={disabled} onClick={() => onLaunch({ endpoint: "/ops/smoke" })}>
            Run smoke tests
          </button>
        </article>

        <article className="admin-ops__card">
          <h4>Replay DLQ</h4>
          <p>Provide message IDs to replay. Large batches require dual approval.</p>
          <textarea
            rows={4}
            placeholder="id-123 id-456 id-789"
            value={replayIds}
            onChange={(e) => setReplayIds(e.target.value)}
          />
          <div className="admin-ops__hint">{replayList.length} IDs entered</div>
          <button
            disabled={disabled || replayList.length === 0}
            onClick={() => onLaunch({ endpoint: "/ops/replay", body: { ids: replayList } })}
          >
            Replay messages
          </button>
        </article>

        <article className="admin-ops__card">
          <h4>Bump Rules Version</h4>
          <p>Promote the governance/ruleset configuration to the next version.</p>
          <input
            type="text"
            placeholder="v2025.10"
            value={rulesVersion}
            onChange={(e) => setRulesVersion(e.target.value)}
          />
          <button
            disabled={disabled}
            onClick={() =>
              onLaunch({ endpoint: "/ops/rules/bump", body: rulesVersion ? { targetVersion: rulesVersion } : {} })
            }
          >
            Promote rules
          </button>
        </article>

        <article className="admin-ops__card">
          <h4>OpenAPI Sync</h4>
          <p>Regenerate OpenAPI contracts from the latest code.</p>
          <button disabled={disabled} onClick={() => onLaunch({ endpoint: "/ops/openapi/regenerate" })}>
            Regenerate spec
          </button>
        </article>

        <article className="admin-ops__card">
          <h4>Docs Validation</h4>
          <p>Lint operational runbooks and evidence bundles for release readiness.</p>
          <button disabled={disabled} onClick={() => onLaunch({ endpoint: "/ops/docs/validate" })}>
            Validate docs
          </button>
        </article>
      </div>
    </section>
  );
}

function JobList({
  jobs,
  onSelect,
  onRetry,
}: {
  jobs: OpsJobRecord[];
  onSelect: (job: OpsJobRecord) => void;
  onRetry: (job: OpsJobRecord) => void;
}) {
  if (!jobs.length) {
    return <div className="admin-ops__empty">No jobs launched yet.</div>;
  }
  return (
    <table className="admin-ops__table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Status</th>
          <th>Progress</th>
          <th>Actor</th>
          <th>Approver</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.id}>
            <td>{formatType(job.type)}</td>
            <td>
              <span className={`status-badge status-${job.status}`}>{statusLabels[job.status] || job.status}</span>
            </td>
            <td>
              <div className="progress-bar">
                <div className="progress-bar__fill" style={{ width: `${job.progress}%` }} />
              </div>
            </td>
            <td>{job.actor}</td>
            <td>{job.approver || (job.requires_dual ? "Required" : "—")}</td>
            <td>{new Date(job.created_at).toLocaleString()}</td>
            <td className="admin-ops__actions">
              <button onClick={() => onSelect(job)}>Details</button>
              {job.status === "failed" && <button onClick={() => onRetry(job)}>Retry</button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatType(type: OpsJobRecord["type"]): string {
  switch (type) {
    case "rules_bump":
      return "Rules bump";
    case "openapi_regenerate":
      return "OpenAPI";
    case "docs_validate":
      return "Docs validation";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

interface JobDetailsProps {
  job: OpsJobRecord;
  jwt: string;
  mfa: string;
  approver?: string;
  headers: Record<string, string>;
  onClose: () => void;
  onJobUpdate: (job: OpsJobRecord) => void;
  onError: (message: string | null) => void;
  error: string | null;
}

function JobDetailsModal({
  job,
  jwt,
  mfa,
  approver,
  headers,
  onClose,
  onJobUpdate,
  onError,
  error,
}: JobDetailsProps) {
  const [currentJob, setCurrentJob] = useState(job);
  useEffect(() => setCurrentJob(job), [job]);

  useEffect(() => {
    const params = new URLSearchParams({ token: jwt, mfa });
    if (approver) params.set("approver", approver);
    const source = new EventSource(`/ops/jobs/${job.id}/stream?${params.toString()}`);
    source.onmessage = (evt) => {
      try {
        const data: OpsJobEvent & { job?: OpsJobRecord } = JSON.parse(evt.data);
        handleEvent(data);
      } catch (err: any) {
        onError(`Failed to parse event: ${err.message}`);
      }
    };
    source.onerror = () => {
      onError("Stream disconnected");
    };
    return () => {
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, jwt, mfa, approver]);

  async function refreshJob() {
    try {
      const res = await fetch(`/ops/jobs/${job.id}`, { headers });
      if (!res.ok) throw new Error(`Failed to fetch job (${res.status})`);
      const { job: fresh } = await res.json();
      setCurrentJob(fresh);
      onJobUpdate(fresh);
      onError(null);
    } catch (err: any) {
      onError(err.message || "Unable to refresh job");
    }
  }

  function handleEvent(event: OpsJobEvent & { job?: OpsJobRecord }) {
    if (event.type === "bootstrap" && event.job) {
      setCurrentJob(event.job);
      onJobUpdate(event.job);
      onError(null);
      return;
    }
    setCurrentJob((prev) => {
      const base = prev ?? job;
      const next = applyEvent(base, event);
      onJobUpdate(next);
      return next;
    });
    onError(null);
  }

  return (
    <div className="admin-ops__modal-backdrop">
      <div className="admin-ops__modal">
        <header>
          <h4>Job details</h4>
          <button onClick={onClose}>Close</button>
        </header>
        <div className="admin-ops__modal-body">
          <dl className="admin-ops__meta">
            <div>
              <dt>Type</dt>
              <dd>{formatType(currentJob.type)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{statusLabels[currentJob.status] || currentJob.status}</dd>
            </div>
            <div>
              <dt>Actor</dt>
              <dd>{currentJob.actor}</dd>
            </div>
            <div>
              <dt>Approver</dt>
              <dd>{currentJob.approver || "—"}</dd>
            </div>
            <div>
              <dt>Progress</dt>
              <dd>{currentJob.progress}%</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{currentJob.started_at ? new Date(currentJob.started_at).toLocaleString() : "—"}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{currentJob.finished_at ? new Date(currentJob.finished_at).toLocaleString() : "—"}</dd>
            </div>
          </dl>

          <section className="admin-ops__logs">
            <h5>Logs</h5>
            <div className="admin-ops__logs-scroll">
              {currentJob.logs?.map((entry: any, idx) => (
                <div key={`${entry.at}-${idx}`} className={`log-entry log-${entry.level}`}>
                  <time>{new Date(entry.at).toLocaleTimeString()}</time>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-ops__artifacts">
            <h5>Artifacts</h5>
            {currentJob.artifacts?.length ? (
              <ul>
                {currentJob.artifacts.map((artifact, idx) => (
                  <li key={`${artifact.name}-${idx}`}>
                    <button onClick={() => downloadArtifact(artifact)}>{artifact.name}</button>
                    {artifact.description && <span className="artifact-desc">{artifact.description}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="admin-ops__empty">No artifacts yet.</div>
            )}
          </section>

          <section className="admin-ops__summary">
            <h5>Summary</h5>
            <pre>{JSON.stringify(currentJob.summary || {}, null, 2)}</pre>
          </section>

          {error && <div className="admin-ops__error">{error}</div>}
        </div>
        <footer>
          <button onClick={refreshJob}>Refresh</button>
        </footer>
      </div>
    </div>
  );
}

function applyEvent(job: OpsJobRecord, event: OpsJobEvent & { job?: OpsJobRecord }): OpsJobRecord {
  if (event.type === "bootstrap" && event.job) {
    return event.job;
  }
  const next: OpsJobRecord = { ...job };
  switch (event.type) {
    case "log":
      next.logs = [...(next.logs || []), event.entry];
      break;
    case "status":
      next.status = event.status;
      next.progress = event.progress;
      if (event.status === "succeeded" || event.status === "failed") {
        next.finished_at = new Date().toISOString();
      }
      break;
    case "artifact":
      next.artifacts = [...(next.artifacts || []), event.artifact];
      break;
    case "summary":
      next.summary = event.summary;
      break;
    default:
      break;
  }
  return next;
}

function downloadArtifact(artifact: JobArtifact) {
  try {
    const encoding = artifact.encoding || "utf8";
    let payload: BlobPart;
    if (encoding === "base64") {
      const bin = atob(artifact.data);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) {
        arr[i] = bin.charCodeAt(i);
      }
      payload = arr;
    } else {
      payload = artifact.data;
    }
    const blob = new Blob([payload], { type: artifact.mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.name || "artifact";
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Failed to download artifact", err);
  }
}
