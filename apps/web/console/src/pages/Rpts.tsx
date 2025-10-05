import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { DataGrid, Tag } from "../components";
import { formatCurrency, formatDateTime } from "../utils/format";

const statusTone: Record<string, "info" | "success" | "warning" | "danger"> = {
  draft: "info",
  pending: "warning",
  issued: "success",
  failed: "danger",
};

export function RptsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["rpts"],
    queryFn: () => api.getRptSchedule(),
    staleTime: 15_000,
  });

  if (isLoading) {
    return <p className="text-sm text-slate-600">Loading RPT schedule…</p>;
  }

  if (error || !data) {
    return (
      <p className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        Unable to load RPT data.
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">RPT timeline</h1>
          <p className="text-sm text-slate-600">Monitor lodgement progress and reconcile rate versions.</p>
        </div>
      </header>
      <DataGrid
        data={data.items}
        getRowId={(item) => item.id}
        caption="RPT schedule"
        emptyState={<span>No RPTs scheduled.</span>}
        columns={[
          {
            key: "period",
            header: "Period",
            render: (item) => <span className="font-medium text-slate-900">{item.period}</span>,
          },
          {
            key: "status",
            header: "Status",
            render: (item) => <Tag tone={statusTone[item.status] ?? "info"}>{item.status.toUpperCase()}</Tag>,
          },
          {
            key: "issuedAt",
            header: "Issued",
            render: (item) => (item.issuedAt ? formatDateTime(item.issuedAt) : <span className="text-slate-400">Pending</span>),
          },
          {
            key: "total",
            header: "Total",
            align: "right",
            render: (item) => formatCurrency(item.total, item.currency),
          },
          {
            key: "ratesVersion",
            header: "Rates version",
            render: (item) => <code className="rounded bg-slate-100 px-2 py-1 text-xs">v{item.ratesVersion}</code>,
          },
        ]}
      />
    </section>
  );
}
