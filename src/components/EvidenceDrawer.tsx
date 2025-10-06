import React, { useEffect, useMemo, useState } from "react";
import type { EvidenceBundle } from "../types/evidence";

type EvidenceDrawerProps = {
  open: boolean;
  periodId: string | null;
  abn: string | null;
  taxType: string | null;
  onClose: () => void;
};

type FetchState = {
  loading: boolean;
  error: string | null;
  data: EvidenceBundle | null;
};

const initialState: FetchState = { loading: false, error: null, data: null };

function buildQuery(abn: string, taxType: string) {
  const params = new URLSearchParams();
  params.set("abn", abn);
  params.set("taxType", taxType);
  return params.toString();
}

export default function EvidenceDrawer({ open, periodId, abn, taxType, onClose }: EvidenceDrawerProps) {
  const [state, setState] = useState<FetchState>(initialState);

  useEffect(() => {
    let active = true;
    if (!open || !periodId || !abn || !taxType) {
      setState(initialState);
      return () => {
        active = false;
      };
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    const query = buildQuery(abn, taxType);

    fetch(`/evidence/${encodeURIComponent(periodId)}.json?${query}`)
      .then(async (res) => {
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || "Unable to fetch evidence bundle");
        }
        return res.json();
      })
      .then((data: EvidenceBundle) => {
        if (!active) return;
        setState({ loading: false, error: null, data });
      })
      .catch((error: Error) => {
        if (!active) return;
        setState({ loading: false, error: error.message, data: null });
      });

    return () => {
      active = false;
    };
  }, [open, periodId, abn, taxType]);

  const prettyJson = useMemo(() => {
    if (!state.data) return "";
    return JSON.stringify(state.data, null, 2);
  }, [state.data]);

  const handleDownloadJson = async () => {
    if (!periodId || !abn || !taxType || !state.data) return;
    const blob = new Blob([prettyJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${periodId}-evidence.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    if (!periodId || !abn || !taxType) return;
    const query = buildQuery(abn, taxType);
    const res = await fetch(`/evidence/${encodeURIComponent(periodId)}.zip?${query}`);
    if (!res.ok) {
      const message = await res.text();
      alert(message || "Unable to download archive");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${periodId}-evidence.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`evidence-drawer-overlay ${open ? "visible" : "hidden"}`}>
      <div className="evidence-drawer">
        <header className="evidence-drawer__header">
          <div>
            <h2>Evidence bundle</h2>
            {periodId && <p className="evidence-drawer__meta">Period {periodId} · ABN {abn}</p>}
          </div>
          <button type="button" className="evidence-drawer__close" onClick={onClose} aria-label="Close evidence drawer">
            ×
          </button>
        </header>
        <div className="evidence-drawer__body">
          {state.loading && <p className="evidence-drawer__status">Loading evidence…</p>}
          {!state.loading && state.error && (
            <div className="evidence-drawer__error">{state.error}</div>
          )}
          {!state.loading && !state.error && state.data && (
            <pre className="evidence-drawer__code">{prettyJson}</pre>
          )}
        </div>
        <footer className="evidence-drawer__footer">
          <button type="button" onClick={handleDownloadJson} className="evidence-drawer__button" disabled={!state.data}>
            Download JSON
          </button>
          <button type="button" onClick={handleDownloadZip} className="evidence-drawer__button" disabled={!state.data}>
            Download ZIP
          </button>
        </footer>
      </div>
    </div>
  );
}
