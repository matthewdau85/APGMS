import { useMemo, useState } from "react";
import { useMutationState } from "@tanstack/react-query";
import { FeatureGate } from "./constants/featureGates";
import {
  getGateState,
  useBasTotals,
  useFeatureGates,
  useIssueRptMutation,
  usePaymentsQueue,
  useReconQueue,
  useRptEvidence,
} from "./api/hooks";
import { ModePill } from "./components/ModePill";
import { KillSwitchBanner } from "./components/KillSwitchBanner";
import { BasTotalsCard } from "./components/BasTotalsCard";
import { IssueRptButton } from "./components/IssueRptButton";
import { QueuePane } from "./components/QueuePane";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { AuditViewer } from "./components/AuditViewer";

export default function App() {
  const { data: gates, isLoading: isLoadingGates } = useFeatureGates();
  const { data: basTotals, isLoading: isLoadingBasTotals } = useBasTotals();
  const { data: paymentsQueue, isLoading: isLoadingPayments } = usePaymentsQueue();
  const { data: reconQueue, isLoading: isLoadingRecon } = useReconQueue();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const issueRptMutation = useIssueRptMutation();
  const isIssuing = issueRptMutation.isPending;

  const killSwitchGate = useMemo(
    () => gates?.find((gate) => gate.gate === FeatureGate.KillSwitchActive),
    [gates]
  );

  const rptEnabled = getGateState(gates, FeatureGate.RptIssuanceEnabled, false);
  const killSwitchActive = getGateState(gates, FeatureGate.KillSwitchActive, false);

  const { data: evidence, isLoading: isEvidenceLoading } = useRptEvidence(drawerOpen);

  const disabled = !rptEnabled || killSwitchActive;
  const disabledReason = !rptEnabled
    ? "Issuance disabled by gate RPT_ISSUANCE_ENABLED."
    : killSwitchActive
      ? "Kill switch is active. Clear KILL_SWITCH_ACTIVE before issuing."
      : undefined;

  const latestRatesVersion = basTotals?.ratesVersion ?? "latest";

  const outstandingMutations = useMutationState({
    filters: { mutationKey: ["issue-rpt"] },
    select: (mutation) => mutation.state.status,
  });

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 px-8 py-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">APGMS Console</h1>
          <p className="text-sm text-slate-400">
            Monitor BAS performance, manage RPT issuance, and track operational queues.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ModePill gates={gates} />
          {isLoadingGates && <span className="text-xs text-slate-500">Syncing gates…</span>}
        </div>
      </header>

      <KillSwitchBanner
        active={killSwitchActive}
        updatedAt={killSwitchGate?.updatedAt}
        updatedBy={killSwitchGate?.updatedBy}
      />

      <main className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          <BasTotalsCard data={basTotals} isLoading={isLoadingBasTotals} />
          <section className="rounded-2xl bg-slate-900/70 p-6 shadow ring-1 ring-white/5">
            <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">RPT Controls</h2>
                <p className="text-xs text-slate-400">
                  Issue reports with rates version {latestRatesVersion}. Feature flags ensure gate parity with the
                  backend.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <IssueRptButton
                  disabled={disabled}
                  disabledReason={disabledReason}
                  onIssue={() => {
                    issueRptMutation.mutate(
                      { ratesVersion: latestRatesVersion },
                      {
                        onSuccess: () => {
                          setDrawerOpen(true);
                        },
                      }
                    );
                  }}
                  isSubmitting={isIssuing}
                />
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="rounded-md border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:bg-slate-800/60"
                >
                  Review Evidence
                </button>
              </div>
            </header>
            {outstandingMutations.length > 0 && (
              <p className="mt-3 text-xs text-slate-400">
                RPT issuance is processing. You can continue to monitor queues while we confirm delivery.
              </p>
            )}
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <QueuePane title="Payments Queue" items={paymentsQueue} isLoading={isLoadingPayments} />
            <QueuePane title="Reconciliation Queue" items={reconQueue} isLoading={isLoadingRecon} />
          </section>
        </div>
        <div className="flex flex-col gap-6">
          <AuditViewer />
        </div>
      </main>

      <EvidenceDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        evidence={evidence}
        isLoading={isEvidenceLoading}
      />
    </div>
  );
}
