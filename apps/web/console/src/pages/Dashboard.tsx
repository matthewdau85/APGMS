import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Tag } from "../components";
import { formatDateTime, formatRelativeSeconds } from "../utils/format";

const severityTone: Record<string, "info" | "warning" | "danger"> = {
  info: "info",
  warning: "warning",
  critical: "danger",
};

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.getDashboardSummary(),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <p className="text-sm text-slate-600">Loading dashboard…</p>;
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        Unable to load dashboard data.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardCard title="Next BAS submission" description={`Rates v${data.basCountdown.ratesVersion}`}>
          <p className="text-3xl font-semibold text-slate-900" aria-live="polite">
            {formatRelativeSeconds(data.basCountdown.secondsRemaining)}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Scheduled for {formatDateTime(data.basCountdown.nextSubmissionUtc)}
          </p>
        </DashboardCard>
        <DashboardCard title="Today's RPTs" description="Issued / Pending / Total">
          <p className="text-3xl font-semibold text-slate-900">
            {data.todaysRpts.issued} / {data.todaysRpts.pending} / {data.todaysRpts.total}
          </p>
        </DashboardCard>
        <DashboardCard title="Unreconciled" description="Anomalies / Unreconciled / DLQ">
          <p className="text-3xl font-semibold text-slate-900">
            {data.unreconciledCounts.anomalies} / {data.unreconciledCounts.unreconciled} / {data.unreconciledCounts.dlq}
          </p>
        </DashboardCard>
        <DashboardCard title="Anomaly blocks" description="Highest severity signals">
          <p className="text-3xl font-semibold text-slate-900">{data.anomalyBlocks.length}</p>
        </DashboardCard>
      </div>

      <section aria-labelledby="anomaly-blocks" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="anomaly-blocks" className="text-base font-semibold text-slate-900">
            Active anomaly blocks
          </h2>
          <p className="text-xs text-slate-500">Last updated {formatDateTime(new Date().toISOString())}</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {data.anomalyBlocks.map((block) => (
            <article key={block.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{block.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{block.description}</p>
                </div>
                <Tag tone={severityTone[block.severity] ?? "warning"}>{block.severity.toUpperCase()}</Tag>
              </div>
              <dl className="mt-3 flex flex-wrap gap-6 text-xs text-slate-500">
                <div>
                  <dt className="font-medium text-slate-700">Updated</dt>
                  <dd>{formatDateTime(block.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-700">Queue</dt>
                  <dd>{block.id}</dd>
                </div>
              </dl>
            </article>
          ))}
          {data.anomalyBlocks.length === 0 && (
            <p className="col-span-full rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
              No anomaly blocks detected.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function DashboardCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-live="polite">
      <h3 className="text-sm font-semibold text-slate-600">{title}</h3>
      {description && <p className="text-xs text-slate-400">{description}</p>}
      <div className="mt-3">{children}</div>
    </article>
  );
}
