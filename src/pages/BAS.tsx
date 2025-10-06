import React from "react";

import { Skeleton } from "../components/Skeleton";
import {
  useBasPreview,
  useDashboardSummary,
  useLodgeBasMutation,
  useValidateBasMutation,
} from "../api/hooks";

export default function BAS() {
  const { data: preview, isLoading } = useBasPreview();
  const { data: summary } = useDashboardSummary();
  const validate = useValidateBasMutation();
  const lodge = useLodgeBasMutation();

  const complianceScore = Math.round((summary?.success_rate ?? 0) * 100);

  return (
    <div className="main-card">
      <h1 className="text-2xl font-bold">Business Activity Statement (BAS)</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Lodge your BAS on time and accurately. Below is the latest draft from the portal API.
      </p>

      <div className="bg-card p-4 rounded-xl shadow space-y-4">
        <h2 className="text-lg font-semibold">Current quarter</h2>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton height={16} />
            <Skeleton height={16} />
            <Skeleton height={16} />
          </div>
        ) : preview ? (
          <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
            <li>
              <strong>Period:</strong> {preview.period}
            </li>
            <li>
              <strong>GST payable:</strong> ${preview.GSTPayable.toFixed(2)}
            </li>
            <li>
              <strong>PAYGW:</strong> ${preview.PAYGW.toFixed(2)}
            </li>
            <li>
              <strong>Total remittance:</strong> ${preview.Total.toFixed(2)}
            </li>
          </ul>
        ) : (
          <p className="text-sm text-gray-600">No draft data available.</p>
        )}
        <div className="flex gap-3 flex-wrap">
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded disabled:opacity-60"
            onClick={() => validate.mutate()}
            disabled={validate.isPending}
          >
            {validate.isPending ? "Validating..." : "Validate with ATO"}
          </button>
          <button
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 px-4 rounded disabled:opacity-60"
            onClick={() => lodge.mutate()}
            disabled={lodge.isPending}
          >
            {lodge.isPending ? "Submitting..." : "Lodge BAS"}
          </button>
        </div>
      </div>

      <div className="bg-green-50 border border-green-200 p-4 rounded-xl shadow-md mt-6">
        <h2 className="text-lg font-semibold text-green-800">Compliance overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-3 text-sm">
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Jobs processed</p>
            <p className="text-slate-700">{summary?.jobs ?? 0} in the last run</p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Success rate</p>
            <p className={complianceScore >= 90 ? "text-green-600" : complianceScore >= 70 ? "text-yellow-600" : "text-red-600"}>
              {complianceScore}%
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">ATO feedback</p>
            <p className="text-sm text-gray-600">{summary?.top_errors?.[0] ?? "No blocking errors reported."}</p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Status</p>
            <p className="text-sm text-gray-600">
              {complianceScore >= 90
                ? "Excellent compliance"
                : complianceScore >= 70
                ? "Good standing"
                : "Needs attention"}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500 italic">
          Staying highly compliant may help avoid audits, reduce penalties, and support eligibility for ATO support programs.
        </p>
      </div>
    </div>
  );
}
