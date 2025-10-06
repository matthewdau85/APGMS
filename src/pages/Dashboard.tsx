// src/pages/Dashboard.tsx
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import AlertsPanel from "../components/AlertsPanel";
import type { DashboardAlert } from "../alerts/types";

const DEFAULT_ABN = "12345678901";

async function fetchAlerts(abn: string): Promise<DashboardAlert[]> {
  const url = new URL("/api/alerts", window.location.origin);
  url.searchParams.set("abn", abn);
  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Failed to load alerts (${res.status})`);
  }
  const json = await res.json();
  return Array.isArray(json.alerts) ? (json.alerts as DashboardAlert[]) : [];
}

function formatCurrency(cents: number | undefined): string {
  if (!Number.isFinite(cents)) return "$0.00";
  return (Number(cents) / 100).toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
  });
}

function formatDateIso(iso?: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  return new Date(ts).toLocaleDateString("en-AU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function Dashboard() {
  const abn = DEFAULT_ABN;
  const { data: alerts = [], isLoading, isError, error } = useQuery<DashboardAlert[]>({
    queryKey: ["alerts", abn],
    queryFn: () => fetchAlerts(abn),
    staleTime: 30_000,
  });

  const overdue = useMemo(
    () => alerts.filter((alert) => alert.code === "OVERDUE_BAS"),
    [alerts]
  );
  const shortfalls = useMemo(
    () => alerts.filter((alert) => alert.code === "OWA_SHORTFALL"),
    [alerts]
  );
  const anomalies = useMemo(
    () => alerts.filter((alert) => alert.code === "RECON_ANOMALY"),
    [alerts]
  );

  const lodgmentsUpToDate = overdue.length === 0;
  const paymentsUpToDate = shortfalls.length === 0;
  const complianceScore = Math.max(
    0,
    100 - overdue.length * 30 - shortfalls.length * 25 - anomalies.length * 15
  );

  const outstandingLodgments = overdue.map((alert) => alert.periodId || "Unspecified period");
  const outstandingAmounts = shortfalls
    .map((alert) => {
      const cents = Number((alert.details as any)?.shortfallCents ?? 0);
      if (!Number.isFinite(cents) || cents <= 0) return null;
      const label = alert.taxType ? `${alert.taxType} shortfall` : "Shortfall";
      return `${formatCurrency(cents)} (${label})`;
    })
    .filter((item): item is string => Boolean(item));

  const nextDue = overdue.length ? formatDateIso((overdue[0].details as any)?.dueDate) : "—";

  return (
    <div className="main-card">
      <AlertsPanel alerts={alerts} isLoading={isLoading} error={isError ? (error as Error) : null} />

      <div className="bg-gradient-to-r from-[#00716b] to-[#009688] text-white p-6 rounded-xl shadow mb-6">
        <h1 className="text-3xl font-bold mb-2">Welcome to APGMS</h1>
        <p className="text-sm opacity-90">
          Automating PAYGW &amp; GST compliance with ATO standards. Stay on track with timely lodgments and payments.
        </p>
        <div className="mt-4">
          <Link to="/wizard" className="bg-white text-[#00716b] font-semibold px-4 py-2 rounded shadow hover:bg-gray-100">
            Get Started
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Lodgments</h2>
          <p className={lodgmentsUpToDate ? "text-green-600" : "text-red-600"}>
            {lodgmentsUpToDate ? "Up to date ✅" : "Overdue ❌"}
          </p>
          <Link to="/bas" className="text-blue-600 text-sm underline">
            View BAS
          </Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Payments</h2>
          <p className={paymentsUpToDate ? "text-green-600" : "text-red-600"}>
            {paymentsUpToDate ? "All paid ✅" : "Outstanding ❌"}
          </p>
          <Link to="/audit" className="text-blue-600 text-sm underline">
            View Audit
          </Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow text-center">
          <h2 className="text-lg font-semibold mb-2">Compliance Score</h2>
          <div className="relative w-16 h-16 mx-auto">
            <svg viewBox="0 0 36 36" className="w-full h-full">
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#eee"
                strokeWidth="2"
              />
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831"
                fill="none"
                stroke="url(#grad)"
                strokeWidth="2"
                strokeDasharray={`${complianceScore}, 100`}
              />
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="red" />
                  <stop offset="50%" stopColor="yellow" />
                  <stop offset="100%" stopColor="green" />
                </linearGradient>
              </defs>
              <text x="18" y="20.35" textAnchor="middle" fontSize="5">
                {complianceScore}%
              </text>
            </svg>
          </div>
          <p className="text-sm mt-2 text-gray-600">
            {complianceScore >= 90 ? "Excellent" : complianceScore >= 70 ? "Good" : "Needs attention"}
          </p>
        </div>
      </div>

      <div className="mt-6 text-sm text-gray-700 space-y-1">
        <p>
          Next BAS due by <strong>{nextDue}</strong>.
        </p>
        {outstandingLodgments.length > 0 && (
          <p className="text-red-600">
            Outstanding Lodgments: {Array.from(new Set(outstandingLodgments)).join(", ")}
          </p>
        )}
        {outstandingAmounts.length > 0 && (
          <p className="text-red-600">
            Outstanding Payments: {outstandingAmounts.join(", ")}
          </p>
        )}
        {isError && (
          <p className="text-red-600">
            Unable to load alerts: {(error as Error)?.message || "unknown error"}
          </p>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
