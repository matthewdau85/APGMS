// src/pages/Dashboard.tsx
import React from "react";
import { Link } from "react-router-dom";
import { useAtoStatus, useBasPreview, useDashboardYesterday } from "../api/client";

function formatPercent(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "–";
  return `${(value * 100).toFixed(1)}%`;
}

function formatCurrency(amount: number | undefined) {
  if (amount === undefined || Number.isNaN(amount)) return "–";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
}

export default function Dashboard() {
  const {
    data: yesterday,
    isLoading: isLoadingYesterday,
    error: yesterdayError,
  } = useDashboardYesterday();
  const {
    data: basPreview,
    isLoading: isLoadingBasPreview,
    error: basError,
  } = useBasPreview();
  const {
    data: atoStatus,
    isLoading: isLoadingAto,
    error: atoError,
  } = useAtoStatus();

  const successRateDisplay = formatPercent(yesterday?.success_rate);
  const topErrors = yesterday?.top_errors ?? [];

  return (
    <div className="main-card space-y-6">
      <div className="bg-gradient-to-r from-[#00716b] to-[#009688] text-white p-6 rounded-xl shadow space-y-2">
        <h1 className="text-3xl font-bold">Welcome to APGMS</h1>
        <p className="text-sm opacity-90">
          Monitor PAYGW & GST operations backed by live portal metrics. These tiles update directly from the
          FastAPI-powered portal service.
        </p>
        <div className="mt-4">
          <Link to="/wizard" className="bg-white text-[#00716b] font-semibold px-4 py-2 rounded shadow hover:bg-gray-100">
            Get Started
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Jobs processed (yesterday)</h2>
          <p className="text-2xl font-bold text-gray-900">
            {isLoadingYesterday ? "Loading…" : yesterdayError ? "Failed" : yesterday?.jobs ?? "–"}
          </p>
          {topErrors.length > 0 ? (
            <ul className="text-xs text-red-600 space-y-1">
              {topErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No errors reported in the latest run.</p>
          )}
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Success rate</h2>
          <p className="text-2xl font-bold text-gray-900">
            {isLoadingYesterday ? "Loading…" : yesterdayError ? "Failed" : successRateDisplay}
          </p>
          <p className="text-xs text-muted-foreground">
            Success rate is calculated by the portal for the previous day&apos;s automation jobs.
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">ATO connection</h2>
          <p className="text-2xl font-bold text-gray-900">
            {isLoadingAto ? "Loading…" : atoError ? "Failed" : atoStatus?.status ?? "Unknown"}
          </p>
          <p className="text-xs text-muted-foreground">Status comes from /ato/status on the portal API.</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">BAS preview</h2>
          <Link to="/bas" className="text-blue-600 text-sm underline">
            View BAS
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Period</p>
            <p className="text-xl font-semibold">
              {isLoadingBasPreview ? "Loading…" : basError ? "Failed" : basPreview?.period ?? "–"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total liability</p>
            <p className="text-xl font-semibold">
              {isLoadingBasPreview ? "Loading…" : basError ? "Failed" : formatCurrency(basPreview?.Total)}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 text-sm">
          <div className="bg-gray-50 p-3 rounded-lg">
            <p className="text-muted-foreground">GST payable</p>
            <p className="font-semibold">{formatCurrency(basPreview?.GSTPayable)}</p>
          </div>
          <div className="bg-gray-50 p-3 rounded-lg">
            <p className="text-muted-foreground">PAYGW</p>
            <p className="font-semibold">{formatCurrency(basPreview?.PAYGW)}</p>
          </div>
          <div className="bg-gray-50 p-3 rounded-lg">
            <p className="text-muted-foreground">Status</p>
            <p className="font-semibold">
              {isLoadingBasPreview ? "Loading…" : basError ? "Failed to load" : "Ready for review"}
            </p>
          </div>
        </div>
      </div>

      {(yesterdayError || basError || atoError) && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded">
          <p className="font-semibold">Live data warning</p>
          <ul className="list-disc list-inside text-sm space-y-1">
            {yesterdayError && <li>Dashboard metrics: {yesterdayError.message}</li>}
            {basError && <li>BAS preview: {basError.message}</li>}
            {atoError && <li>ATO status: {atoError.message}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
