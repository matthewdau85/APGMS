import React, { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  PayrollEntry,
  PayrollIntegrationData,
  PayrollProvider,
  connectPayrollProvider,
  fetchPayrollData,
} from "../utils/payrollApi";

interface IntegrationState {
  entries: PayrollEntry[];
  connectedProviders: PayrollProvider[];
  availableProviders: PayrollProvider[];
}

const initialState: IntegrationState = {
  entries: [],
  connectedProviders: [],
  availableProviders: [],
};

export default function PayrollIntegration() {
  const [state, setState] = useState<IntegrationState>(initialState);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPayrollData();
        if (!isMounted) return;
        applyData(data);
      } catch (err) {
        if (!isMounted) return;
        setError(normalizeError(err));
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProvider && state.availableProviders.length > 0) {
      const next = state.availableProviders.find((provider) => !provider.connected)?.id ?? state.availableProviders[0]?.id ?? "";
      setSelectedProvider(next);
    }
  }, [state.availableProviders, selectedProvider]);

  const statusMessage = useMemo(() => {
    if (error) {
      return {
        label: "Error",
        tone: "#b00020",
        description: error,
      };
    }
    if (loading) {
      return {
        label: "Loading",
        tone: "#00695c",
        description: "Fetching payroll data from connected providers...",
      };
    }
    if (state.entries.length === 0) {
      return {
        label: "No data",
        tone: "#555",
        description: "Connect a payroll provider to pull employee records automatically.",
      };
    }
    return {
      label: "Synced",
      tone: "#2e7d32",
      description: `Retrieved ${state.entries.length} employee payroll entries${
        lastUpdated ? ` · Last updated ${lastUpdated}` : ""
      }`,
    };
  }, [error, loading, state.entries.length, lastUpdated]);

  async function handleRefresh() {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchPayrollData();
      applyData(data);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    if (!selectedProvider) return;
    setSyncing(true);
    setError(null);
    try {
      const data = await connectPayrollProvider(selectedProvider);
      applyData(data);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setSyncing(false);
    }
  }

  function applyData(data: PayrollIntegrationData) {
    setState({
      entries: data.entries,
      connectedProviders: data.connectedProviders,
      availableProviders: data.availableProviders,
    });
    setLastUpdated(new Date().toLocaleTimeString());
  }

  const availableOptions = state.availableProviders.map((provider) => (
    <option key={provider.id} value={provider.id}>
      {provider.name} {provider.connected ? "(Connected)" : ""}
    </option>
  ));

  return (
    <div className="card">
      <h3>Payroll Integration</h3>
      <p>
        <b>Automatically ingest payroll data from connected providers.</b>
        <br />
        <span style={{ color: "#444", fontSize: "0.97em" }}>
          Connect services such as Xero, MYOB, or QuickBooks to stream PAYGW data into APGMS.
        </span>
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.95em" }}>
          Provider
          <select
            value={selectedProvider}
            onChange={(event) => setSelectedProvider(event.target.value)}
            disabled={loading || syncing || state.availableProviders.length === 0}
            style={{ minWidth: 200, padding: "0.4rem" }}
          >
            {availableOptions}
          </select>
        </label>
        <button
          onClick={handleConnect}
          className="button"
          disabled={!selectedProvider || syncing || loading}
        >
          {syncing ? "Connecting..." : "Connect Provider"}
        </button>
        <button onClick={handleRefresh} className="button" disabled={loading || syncing}>
          Refresh
        </button>
        <span
          style={{
            padding: "0.35rem 0.65rem",
            borderRadius: "999px",
            backgroundColor: "#e0f2f1",
            color: statusMessage.tone,
            fontSize: "0.85em",
            fontWeight: 600,
          }}
        >
          {statusMessage.label}
        </span>
      </div>

      <div style={{ marginBottom: "0.75rem", color: statusMessage.tone, fontSize: "0.9em" }}>
        {statusMessage.description}
      </div>

      {state.connectedProviders.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h4>Connected Providers</h4>
          <ul>
            {state.connectedProviders.map((provider) => (
              <li key={provider.id}>
                <b>{provider.name}</b>
                {provider.status ? ` · ${provider.status}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div style={{ color: "#b00020", fontSize: "0.9em", marginBottom: "1rem" }}>
          Unable to retrieve payroll data. {error}
        </div>
      )}

      {!loading && state.entries.length > 0 && (
        <>
          <h4>Payroll Entries</h4>
          <ul>
            {state.entries.map((entry, index) => (
              <li key={`${entry.employee}-${index}`}>
                <b>{entry.employee}</b>: Gross ${entry.gross.toLocaleString(undefined, { minimumFractionDigits: 2 })} | Withheld ${
                  entry.withheld.toLocaleString(undefined, { minimumFractionDigits: 2 })
                }
                {entry.providerId ? ` · ${entry.providerId}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function normalizeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.message} (status ${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}
