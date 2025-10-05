// src/pages/Dashboard.tsx
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import {
  DEFAULT_ABN,
  buildComplianceSummary,
  getPeriodList,
  getPeriodSortValue,
  statusClass
} from "./complianceUtils";

export default function Dashboard() {
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

  const latestPeriod = useMemo(() => {
    const ordered = [...periods].sort((a, b) => getPeriodSortValue(b) - getPeriodSortValue(a));
    return ordered[0];
  }, [periods]);

  const latestPeriodId = latestPeriod && (latestPeriod.period_id ?? latestPeriod.periodId ?? latestPeriod.id);

  const gateQuery = useQuery({
    queryKey: ["gate", abn, latestPeriodId],
    queryFn: () => api.gate(abn, latestPeriodId as string),
    enabled: Boolean(latestPeriodId)
  });

  const summary = useMemo(
    () => buildComplianceSummary(periodsQuery.data, balanceQuery.data, gateQuery.data, periods),
    [periodsQuery.data, balanceQuery.data, gateQuery.data, periods]
  );

  const complianceValue = summary.complianceScore != null
    ? Math.max(0, Math.min(100, summary.complianceScore))
    : null;

  return (
    <div className="main-card">
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
          {periodsQuery.isLoading ? (
            <p className="text-gray-500">Loading lodgment status…</p>
          ) : periodsQuery.isError ? (
            <p className="text-red-600">Unable to load lodgment status.</p>
          ) : (
            <p className={statusClass(summary.lodgments.bool)}>
              {summary.lodgments.label ?? (summary.lodgments.bool ? "Up to date ✅" : summary.lodgments.bool === false ? "Needs attention ❌" : "Status unavailable")}
            </p>
          )}
          <Link to="/bas" className="text-blue-600 text-sm underline">View BAS</Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Payments</h2>
          {balanceQuery.isLoading ? (
            <p className="text-gray-500">Checking payment status…</p>
          ) : balanceQuery.isError ? (
            <p className="text-red-600">Unable to load payment status.</p>
          ) : (
            <p className={statusClass(summary.payments.bool)}>
              {summary.payments.label ?? (summary.payments.bool ? "All paid ✅" : summary.payments.bool === false ? "Outstanding ❌" : "Status unavailable")}
            </p>
          )}
          <Link to="/audit" className="text-blue-600 text-sm underline">View Audit</Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow text-center">
          <h2 className="text-lg font-semibold mb-2">Compliance</h2>
          <div className="relative w-20 h-20 mx-auto">
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
                  stroke="url(#grad)"
                  strokeWidth="2"
                  strokeDasharray={`${complianceValue}, 100`}
                />
              ) : null}
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="red" />
                  <stop offset="50%" stopColor="yellow" />
                  <stop offset="100%" stopColor="green" />
                </linearGradient>
              </defs>
              <text x="18" y="20.35" textAnchor="middle" fontSize="5">
                {complianceValue != null ? `${Math.round(complianceValue)}%` : "--"}
              </text>
            </svg>
          </div>
          <p className="text-sm mt-2 text-gray-600">
            {gateQuery.isLoading
              ? "Fetching gate status…"
              : gateQuery.isError
              ? "Unable to fetch gate status."
              : summary.complianceLabel ?? "Status unavailable"}
          </p>
        </div>
      </div>

      <div className="mt-6 text-sm text-gray-700">
        {periodsQuery.isLoading ? (
          <p>Loading compliance timeline…</p>
        ) : periodsQuery.isError ? (
          <p className="text-red-600">Unable to load compliance timeline.</p>
        ) : (
          <>
            <p>
              Last BAS lodged on <strong>{summary.lastBAS ?? "—"}</strong>. {" "}
              <Link to="/bas" className="text-blue-600 underline">Go to BAS</Link>
            </p>
            <p>Next BAS due by <strong>{summary.nextDue ?? "—"}</strong>.</p>
            {summary.outstandingLodgments.length > 0 ? (
              <p className="text-red-600">
                Outstanding Lodgments: {summary.outstandingLodgments.join(", ")}
              </p>
            ) : null}
            {summary.outstandingAmounts.length > 0 ? (
              <p className="text-red-600">
                Outstanding Payments: {summary.outstandingAmounts.join(", ")}
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
