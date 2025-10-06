import React from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { request } from "./api/client";
import { RequestError, isRequestError } from "./api/errors";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { LoadingState } from "./components/LoadingState";
import { ToastProvider, useToasts } from "./components/ToastProvider";
import { ToastViewport } from "./components/ToastViewport";
import { RequestTraceProvider, useRequestTrace } from "./providers/RequestTraceProvider";
import { createRequestId } from "./utils/request-id";
import { subscribeToRequestTrace } from "./tracing/trace-emitter";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

interface StatusTile {
  id: string;
  title: string;
  summary: string;
  status: "healthy" | "degraded" | "down";
  helpUrl: string;
}

interface StatusResponse {
  tiles: StatusTile[];
}

const CURRENT_USER = {
  name: "Alex Parker",
  role: "admin" as const,
};

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <RequestTraceProvider>
      <ToastProvider>
        <RequestFailureToasts />
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        <ToastViewport />
      </ToastProvider>
    </RequestTraceProvider>
  );
}

export function AppShell() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #020617, #0f172a)",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <GlobalStyles />
      <header
        style={{
          padding: "24px 32px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>APGMS Console</h1>
          <p style={{ margin: "6px 0 0", color: "#94a3b8" }}>Operational overview &amp; RPT insights</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>Signed in as</p>
          <p style={{ margin: 0, fontWeight: 600 }}>{CURRENT_USER.name}</p>
        </div>
      </header>
      <main style={{ padding: "32px", maxWidth: 960, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "grid", gap: 24 }}>
          <StatusOverview />
          <OperationsPanel />
        </div>
      </main>
      <FooterTraces />
    </div>
  );
}

function StatusOverview() {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<StatusResponse, RequestError>({
    queryKey: ["status-tiles"],
    queryFn: async () => {
      const result = await request<StatusResponse>("/status.json");
      return result.data;
    },
  });

  if (isLoading) {
    return (
      <section>
        <SectionHeader
          title="Status tiles"
          description="Live health indicators from APGMS subsystems"
        />
        <LoadingState label="Loading health summaries" />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section>
        <SectionHeader
          title="Status tiles"
          description="Live health indicators from APGMS subsystems"
        />
        <ErrorState
          error={error}
          onRetry={() => refetch()}
          helpUrl="https://docs.apgms.local/status-triage"
          helpLabel="Status triage playbook"
        />
      </section>
    );
  }

  if (!data.tiles.length) {
    return (
      <section>
        <SectionHeader
          title="Status tiles"
          description="Live health indicators from APGMS subsystems"
        />
        <EmptyState
          title="No tiles configured yet"
          description="Provision the reporting widgets in the admin portal to populate this dashboard."
          helpUrl="https://docs.apgms.local/status-setup"
          helpLabel="Set up status tiles"
          action={<button style={linkButtonStyle} onClick={() => refetch()}>Refresh</button>}
        />
      </section>
    );
  }

  return (
    <section>
      <SectionHeader
        title="Status tiles"
        description="Live health indicators from APGMS subsystems"
      />
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        {data.tiles.map((tile) => (
          <article
            key={tile.id}
            style={{
              borderRadius: 12,
              border: "1px solid rgba(148, 163, 184, 0.25)",
              padding: 20,
              background: "rgba(15, 23, 42, 0.7)",
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>{tile.title}</h3>
              <StatusBadge status={tile.status} />
            </header>
            <p style={{ margin: "12px 0", color: "#94a3b8", lineHeight: 1.4 }}>{tile.summary}</p>
            <a href={tile.helpUrl} target="_blank" rel="noreferrer" style={{ color: "#93c5fd" }}>
              View runbook
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: StatusTile["status"] }) {
  const color =
    status === "healthy" ? "#22c55e" : status === "degraded" ? "#facc15" : "#ef4444";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        color,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
        }}
      />
      {status.toUpperCase()}
    </span>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <header style={{ marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
      <p style={{ margin: "6px 0 0", color: "#94a3b8" }}>{description}</p>
    </header>
  );
}

function OperationsPanel() {
  const { push } = useToasts();
  const isAdmin = CURRENT_USER.role === "admin";

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await request<{ success: boolean }>("/api/run-rpt-sync", {
        method: "POST",
        body: JSON.stringify({ scope: "full" }),
        headers: { "content-type": "application/json" },
        meta: {
          label: "Report sync job",
          skipGlobalErrorToast: true,
        },
      });
      return result;
    },
    onSuccess: ({ requestId }) => {
      push({
        title: "Sync scheduled",
        description: "We&apos;ll notify you when the report refresh completes.",
        requestId,
        variant: "success",
        autoClose: true,
      });
    },
    onError: (error: unknown) => {
      const requestError = isRequestError(error)
        ? error
        : new RequestError("Failed to trigger sync", {
            requestId: createRequestId(),
          });
      push({
        title: "Failed to trigger data sync",
        description: requestError.message,
        requestId: requestError.requestId,
        variant: "error",
        action:
          isAdmin && requestError.requestId
            ? {
                label: "Open trace logs",
                href: `https://logs.apgms.local/requests/${requestError.requestId}`,
              }
            : undefined,
        autoClose: false,
      });
    },
  });

  return (
    <section>
      <SectionHeader
        title="Operations"
        description="Run maintenance jobs and triage issues"
      />
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          style={{
            padding: "12px 20px",
            borderRadius: 10,
            border: "none",
            background: mutation.isPending ? "#334155" : "#2563eb",
            color: "white",
            fontWeight: 600,
            cursor: mutation.isPending ? "wait" : "pointer",
          }}
        >
          {mutation.isPending ? "Scheduling..." : "Schedule report sync"}
        </button>
        <p style={{ margin: 0, color: "#94a3b8" }}>
          Starts a full refresh of downstream RPT datasets.
        </p>
      </div>
    </section>
  );
}

function FooterTraces() {
  const { lastTrace } = useRequestTrace();
  if (!lastTrace) {
    return null;
  }
  return (
    <footer
      style={{
        marginTop: 48,
        padding: "16px 32px",
        borderTop: "1px solid rgba(148, 163, 184, 0.2)",
        fontSize: 12,
        color: "#94a3b8",
      }}
    >
      <p style={{ margin: 0 }}>
        Last request: <span style={{ fontFamily: "ui-monospace" }}>{lastTrace.requestId}</span> · {lastTrace.method} {" "}
        {lastTrace.url} · {lastTrace.success ? "success" : "error"}
      </p>
    </footer>
  );
}

const linkButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid rgba(148, 163, 184, 0.4)",
  background: "transparent",
  color: "#93c5fd",
  cursor: "pointer",
};

function RequestFailureToasts() {
  const { push } = useToasts();
  const handledRef = React.useRef(new Set<string>());

  React.useEffect(() => {
    return subscribeToRequestTrace((trace) => {
      if (trace.success) {
        return;
      }
      if (trace.autoToast === false) {
        return;
      }
      const handled = handledRef.current;
      if (handled.has(trace.requestId)) {
        return;
      }
      handled.add(trace.requestId);

      const description = trace.label ?? `${trace.method} ${trace.url}`;

      push({
        title: trace.errorMessage ?? "Request failed",
        description,
        requestId: trace.requestId,
        variant: "error",
        action:
          CURRENT_USER.role === "admin"
            ? {
                label: "Open trace logs",
                href: `https://logs.apgms.local/requests/${trace.requestId}`,
              }
            : undefined,
        autoClose: false,
      });
    });
  }, [push]);

  return null;
}

function GlobalStyles() {
  return (
    <style>
      {`
        :root { color-scheme: dark; }
        body { margin: 0; background: #020617; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        button { font-family: inherit; }
      `}
    </style>
  );
}
