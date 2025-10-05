import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import {
  DEFAULT_ABN,
  buildComplianceSummary,
  formatAmountCandidate,
  formatDateCandidate,
  getPeriodList,
  getPeriodSortValue,
  statusClass,
  findLatestLodgedDate,
  findNextDueDate
} from "./complianceUtils";

export default function BAS() {
  const abn = DEFAULT_ABN;

  const periodsQuery = useQuery({
    queryKey: ["periods", abn],
    queryFn: () => api.periods(abn)
  });

  const balanceQuery = useQuery({
    queryKey: ["balance", abn],
    queryFn: () => api.balance(abn)
  });

  const periods = useMemo(() => getPeriodList(periodsQuery.data), [periodsQuery.data]);

  const sortedPeriods = useMemo(() => {
    const ordered = [...periods].sort((a, b) => getPeriodSortValue(b) - getPeriodSortValue(a));
    return ordered;
  }, [periods]);

  const activePeriod = sortedPeriods[0];
  const activePeriodId = activePeriod && (activePeriod.period_id ?? activePeriod.periodId ?? activePeriod.id);

  const gateQuery = useQuery({
    queryKey: ["gate", abn, activePeriodId],
    queryFn: () => api.gate(abn, activePeriodId as string),
    enabled: Boolean(activePeriodId)
  });

  const evidenceQuery = useQuery({
    queryKey: ["evidence", abn, activePeriodId],
    queryFn: () => api.evidence(abn, activePeriodId as string),
    enabled: Boolean(activePeriodId)
  });

  const summary = useMemo(
    () => buildComplianceSummary(periodsQuery.data, balanceQuery.data, gateQuery.data, periods),
    [periodsQuery.data, balanceQuery.data, gateQuery.data, periods]
  );

  const complianceValue = summary.complianceScore != null
    ? Math.max(0, Math.min(100, summary.complianceScore))
    : null;

  const basEntries = useMemo(() => extractBasEntries(evidenceQuery.data), [evidenceQuery.data]);

  const lastBAS = summary.lastBAS ?? formatDateCandidate(findLatestLodgedDate(periods));
  const nextDue = summary.nextDue ?? formatDateCandidate(findNextDueDate(periods));

  const reminderActive = summary.lodgments.bool === false || summary.payments.bool === false;

  return (
    <div className="main-card">
      <h1 className="text-2xl font-bold">Business Activity Statement (BAS)</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Lodge your BAS on time and accurately. Below is a summary of your current obligations.
      </p>

      {periodsQuery.isLoading || balanceQuery.isLoading ? (
        <div className="bg-card border border-dashed border-gray-300 text-gray-600 p-4 rounded mb-4">
          Gathering compliance status…
        </div>
      ) : periodsQuery.isError || balanceQuery.isError ? (
        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded mb-4">
          Unable to load compliance status from the API.
        </div>
      ) : reminderActive ? (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded mb-4">
          <p className="font-medium">Reminder:</p>
          <p>Your BAS has outstanding lodgments or payments. Resolve to avoid penalties.</p>
        </div>
      ) : null}

      <div className="bg-card p-4 rounded-xl shadow space-y-4">
        <h2 className="text-lg font-semibold">Current Period</h2>
        {evidenceQuery.isLoading ? (
          <p className="text-sm text-gray-600">Loading BAS details…</p>
        ) : evidenceQuery.isError ? (
          <p className="text-sm text-red-600">Unable to load BAS evidence.</p>
        ) : basEntries.length === 0 ? (
          <p className="text-sm text-gray-600">No BAS line items reported for the selected period.</p>
        ) : (
          <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
            {basEntries.map(entry => (
              <li key={entry.code}>
                <strong>{entry.code}:</strong> {entry.value}
              </li>
            ))}
          </ul>
        )}
        <button className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded" disabled={periodsQuery.isLoading || evidenceQuery.isLoading}>
          Review &amp; Lodge
        </button>
      </div>

      <div className="bg-green-50 border border-green-200 p-4 rounded-xl shadow-md mt-6">
        <h2 className="text-lg font-semibold text-green-800">Compliance Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-3 text-sm">
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Lodgments</p>
            {periodsQuery.isLoading ? (
              <p className="text-gray-500">Checking lodgments…</p>
            ) : periodsQuery.isError ? (
              <p className="text-red-600">Unable to load.</p>
            ) : (
              <p className={statusClass(summary.lodgments.bool)}>
                {summary.lodgments.label ?? (summary.lodgments.bool ? "Up to date ✅" : summary.lodgments.bool === false ? "Outstanding ❌" : "Status unavailable")}
              </p>
            )}
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Payments</p>
            {balanceQuery.isLoading ? (
              <p className="text-gray-500">Checking payments…</p>
            ) : balanceQuery.isError ? (
              <p className="text-red-600">Unable to load.</p>
            ) : (
              <p className={statusClass(summary.payments.bool)}>
                {summary.payments.label ?? (summary.payments.bool ? "All paid ✅" : summary.payments.bool === false ? "Outstanding ❌" : "Status unavailable")}
              </p>
            )}
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Compliance Score</p>
            <div className="relative w-24 h-24 mx-auto">
              <svg viewBox="0 0 36 36" className="w-full h-full">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#eee"
                  strokeWidth="2"
                />
                {complianceValue != null ? (
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831"
                    fill="none"
                    stroke="url(#bas-grad)"
                    strokeWidth="2"
                    strokeDasharray={`${complianceValue}, 100`}
                  />
                ) : null}
                <defs>
                  <linearGradient id="bas-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="red" />
                    <stop offset="50%" stopColor="yellow" />
                    <stop offset="100%" stopColor="green" />
                  </linearGradient>
                </defs>
                <text x="18" y="20.35" textAnchor="middle" fontSize="6">
                  {complianceValue != null ? `${Math.round(complianceValue)}%` : "--"}
                </text>
              </svg>
            </div>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Status</p>
            <p className="text-sm text-gray-600">
              {gateQuery.isLoading
                ? "Fetching gate status…"
                : gateQuery.isError
                ? "Unable to fetch gate status."
                : summary.complianceLabel ?? "Status unavailable"}
            </p>
          </div>
        </div>
        <div className="mt-4 text-sm text-gray-700 space-y-1">
          <p>
            Last BAS lodged on <strong>{lastBAS ?? "—"}</strong>.
          </p>
          <p>
            Next BAS due by <strong>{nextDue ?? "—"}</strong>.
          </p>
          {summary.outstandingLodgments.length > 0 ? (
            <p className="text-red-600">Outstanding Lodgments: {summary.outstandingLodgments.join(", ")}</p>
          ) : null}
          {summary.outstandingAmounts.length > 0 ? (
            <p className="text-red-600">Outstanding Payments: {summary.outstandingAmounts.join(", ")}</p>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-gray-500 italic">
          Staying highly compliant may help avoid audits, reduce penalties, and support eligibility for ATO support programs.
        </p>
      </div>
    </div>
  );
}

function extractBasEntries(evidence: any): Array<{ code: string; value: string }> {
  const entries: Array<{ code: string; value: string }> = [];
  if (!evidence) return entries;

  const labelsSource = evidence?.bas_labels ?? evidence?.basLabels ?? evidence?.labels;
  if (labelsSource && typeof labelsSource === "object") {
    Object.entries(labelsSource as Record<string, unknown>).forEach(([code, value]) => {
      const formatted = formatAmountCandidate(value);
      entries.push({ code, value: formatted ?? formatFallbackValue(value) });
    });
  }

  if (!entries.length && evidence?.period && typeof evidence.period === "object") {
    Object.entries(evidence.period as Record<string, unknown>).forEach(([code, value]) => {
      if (/^[A-Z0-9]+$/.test(code)) {
        const formatted = formatAmountCandidate(value);
        entries.push({ code, value: formatted ?? formatFallbackValue(value) });
      }
    });
  }

  return entries.sort((a, b) => a.code.localeCompare(b.code));
}

function formatFallbackValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.label === "string") return obj.label;
    if (typeof obj.value === "string") return obj.value;
  }
  return "—";
}
