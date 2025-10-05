import { clsx } from "clsx";
import type { RptEvidenceResponse } from "../api/schema";
import { decodeJws } from "../lib/jws";

interface EvidenceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  evidence?: RptEvidenceResponse;
  isLoading: boolean;
}

export function EvidenceDrawer({ isOpen, onClose, evidence, isLoading }: EvidenceDrawerProps) {
  const decoded = (() => {
    if (!evidence) return null;
    try {
      return decodeJws(evidence.evidenceToken);
    } catch (error) {
      console.error("Failed to decode RPT evidence", error);
      return null;
    }
  })();

  return (
    <div
      className={clsx(
        "pointer-events-none fixed inset-0 z-40 flex justify-end bg-slate-950/50 backdrop-blur transition",
        isOpen ? "opacity-100" : "opacity-0"
      )}
      aria-hidden={!isOpen}
    >
      <aside
        className={clsx(
          "pointer-events-auto flex h-full w-full max-w-xl flex-col gap-4 border-l border-white/10 bg-slate-900/95 p-6 shadow-xl transition-transform",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="RPT Evidence"
      >
        <header className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">RPT Evidence</h3>
            <p className="text-xs text-slate-400">RPT {evidence?.rptId ?? "—"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-1 text-xs uppercase tracking-wide text-slate-300 hover:bg-slate-800/60"
          >
            Close
          </button>
        </header>
        {isLoading && <p className="text-sm text-slate-300">Loading latest evidence…</p>}
        {!isLoading && decoded && (
          <div className="flex flex-col gap-4 overflow-y-auto text-xs text-slate-100">
            <section>
              <h4 className="font-semibold uppercase tracking-wide text-slate-400">Header</h4>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-950/60 p-3 text-[11px]">
                {JSON.stringify(decoded.header, null, 2)}
              </pre>
            </section>
            <section>
              <h4 className="font-semibold uppercase tracking-wide text-slate-400">Payload</h4>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950/60 p-3 text-[11px]">
                {JSON.stringify(decoded.payload, null, 2)}
              </pre>
            </section>
            <section>
              <h4 className="font-semibold uppercase tracking-wide text-slate-400">Signature</h4>
              <code className="mt-2 block break-all rounded-lg bg-slate-950/60 p-3 text-[11px]">
                {decoded.signature}
              </code>
            </section>
          </div>
        )}
        {!isLoading && !decoded && (
          <p className="text-sm text-rose-200">Unable to decode the evidence payload.</p>
        )}
      </aside>
    </div>
  );
}
