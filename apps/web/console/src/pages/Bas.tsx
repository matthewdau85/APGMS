import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, BasEvidence, decodeCompactJwsPayload } from "../api";
import { ConfirmModal, Drawer, JsonViewer, Tag, useToast } from "../components";
import { formatCurrency, formatDateTime, formatRelativeSeconds } from "../utils/format";

export function BasPage() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmDryRun, setConfirmDryRun] = useState(false);
  const [evidenceDrawer, setEvidenceDrawer] = useState<{ open: boolean; evidence?: BasEvidence; loading: boolean }>(
    { open: false, evidence: undefined, loading: false },
  );

  const { data: status, isLoading, error } = useQuery({
    queryKey: ["bas-status"],
    queryFn: () => api.getBasStatus(),
    staleTime: 30_000,
  });

  const issueMutation = useMutation({
    mutationFn: ({ dryRun }: { dryRun: boolean }) => api.issueBasRpt({ dryRun }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["bas-status"] });
      if (response.evidence) {
        setEvidenceDrawer({ open: true, evidence: response.evidence, loading: false });
      }
      pushToast({
        title: response.message,
        description: response.status.canUndo ? "Undo is now available." : undefined,
        tone: "success",
      });
    },
    onError: (mutationError: unknown) => {
      const message = mutationError instanceof Error ? mutationError.message : "Unable to issue RPT";
      pushToast({ title: "Issue failed", description: message, tone: "danger" });
    },
  });

  const undoMutation = useMutation({
    mutationFn: () => api.undoBasRpt(),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["bas-status"] });
      pushToast({ title: response.message, tone: "info" });
    },
    onError: (mutationError: unknown) => {
      const message = mutationError instanceof Error ? mutationError.message : "Unable to undo";
      pushToast({ title: "Undo failed", description: message, tone: "danger" });
    },
  });

  const totals = status?.totals;
  const decodedEvidence = useMemo(() => {
    if (!evidenceDrawer.evidence) return undefined;
    try {
      const decoded = decodeCompactJwsPayload(evidenceDrawer.evidence.compactJws);
      return { ...decoded, merkleRoot: evidenceDrawer.evidence.merkleRoot, traceId: evidenceDrawer.evidence.traceId };
    } catch (decodeError) {
      pushToast({
        title: "Unable to decode evidence",
        description: decodeError instanceof Error ? decodeError.message : "Invalid payload",
        tone: "danger",
      });
      return undefined;
    }
  }, [evidenceDrawer.evidence, pushToast]);

  async function openEvidence(traceId: string) {
    setEvidenceDrawer({ open: true, loading: true, evidence: undefined });
    try {
      const evidence = await api.getEvidence(traceId);
      setEvidenceDrawer({ open: true, evidence, loading: false });
    } catch (fetchError) {
      pushToast({
        title: "Evidence unavailable",
        description: fetchError instanceof Error ? fetchError.message : "Unable to load evidence",
        tone: "danger",
      });
      setEvidenceDrawer({ open: false, evidence: undefined, loading: false });
    }
  }

  function handleIssue(dryRun: boolean) {
    setConfirmDryRun(dryRun);
    setShowConfirm(true);
  }

  function confirmIssue() {
    issueMutation.mutate({ dryRun: confirmDryRun });
    setShowConfirm(false);
  }

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-slate-900">Business Activity Statement</h1>
            <p className="text-sm text-slate-600">
              Rates pinned to <strong>v{status?.pinnedRatesVersion ?? "—"}</strong>
            </p>
            {status && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>
                  Next submission in {formatRelativeSeconds(status.countdown.secondsRemaining)}
                </span>
                <span>Scheduled {formatDateTime(status.countdown.nextSubmissionUtc)}</span>
                {status.lastIssuedAt && <span>Last issued {formatDateTime(status.lastIssuedAt)}</span>}
              </div>
            )}
          </div>
          <div className="flex flex-col items-stretch gap-3">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus-visible:ring focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              disabled={Boolean(status?.issueDisabledReason) || issueMutation.isPending || isLoading}
              onClick={() => handleIssue(false)}
              aria-disabled={Boolean(status?.issueDisabledReason)}
              aria-describedby={status?.issueDisabledReason ? "issue-disabled-reason" : undefined}
            >
              Issue RPT
            </button>
            {status?.issueDisabledReason && (
              <span id="issue-disabled-reason" className="text-xs text-rose-600">
                {status.issueDisabledReason}
              </span>
            )}
            {status?.dryRunAvailable && (
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring focus-visible:ring-blue-500/60"
                onClick={() => handleIssue(true)}
                disabled={issueMutation.isPending}
              >
                Dry-run
              </button>
            )}
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:text-slate-400"
              onClick={() => undoMutation.mutate()}
              disabled={!status?.canUndo || undoMutation.isPending}
            >
              Undo last issue
            </button>
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <TotalsCard title="Collected" value={totals ? formatCurrency(totals.collected, totals.currency) : "—"} />
        <TotalsCard title="Remitted" value={totals ? formatCurrency(totals.remitted, totals.currency) : "—"} />
        <TotalsCard title="Outstanding" value={totals ? formatCurrency(totals.outstanding, totals.currency) : "—"} />
      </section>

      {status?.canUndo && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-medium">Latest submission is awaiting confirmation.</p>
          <p>
            Trace evidence is available for review. Use undo if submission was triggered in error.
          </p>
          {status.latestTraceId && (
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
              onClick={() => openEvidence(status.latestTraceId!)}
            >
              View evidence
            </button>
          )}
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-600">Fetching BAS totals…</p>}
      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Unable to load BAS status.
        </p>
      )}

      <ConfirmModal
        open={showConfirm}
        title={confirmDryRun ? "Confirm BAS dry-run" : "Confirm BAS submission"}
        description={
          confirmDryRun
            ? "A dry-run will validate totals and evidence without issuing the RPT."
            : "Issuing will submit totals using the pinned rates version."
        }
        confirmLabel={confirmDryRun ? "Run dry-run" : "Issue RPT"}
        onCancel={() => setShowConfirm(false)}
        onConfirm={confirmIssue}
        danger={!confirmDryRun}
      >
        <p>
          Totals are calculated with <Tag tone="info">Rates v{status?.pinnedRatesVersion ?? "?"}</Tag>.
        </p>
        <p className="mt-2 text-slate-600">
          Ensure supporting documents are ready. Evidence will be generated upon completion.
        </p>
      </ConfirmModal>

      <Drawer
        open={evidenceDrawer.open}
        onClose={() => setEvidenceDrawer({ open: false, evidence: undefined, loading: false })}
        title="Submission evidence"
        description="Decoded payload from the compact JWS"
      >
        {evidenceDrawer.loading && <p className="text-sm text-slate-600">Loading evidence…</p>}
        {!evidenceDrawer.loading && evidenceDrawer.evidence && (
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-slate-600">Trace ID</dt>
                  <dd className="break-all">{evidenceDrawer.evidence.traceId}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-600">Merkle root</dt>
                  <dd className="break-all">{evidenceDrawer.evidence.merkleRoot}</dd>
                </div>
              </dl>
            </div>
            {decodedEvidence && (
              <JsonViewer value={decodedEvidence} title="Decoded payload" maxHeight={360} />
            )}
          </div>
        )}
        {!evidenceDrawer.loading && !evidenceDrawer.evidence && (
          <p className="text-sm text-slate-600">No evidence payload available.</p>
        )}
      </Drawer>
    </div>
  );
}

function TotalsCard({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-live="polite">
      <h3 className="text-sm font-semibold text-slate-600">{title}</h3>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </article>
  );
}
