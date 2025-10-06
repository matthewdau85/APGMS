import React from "react";

import { Skeleton } from "../components/Skeleton";
import { useTransactions } from "../api/hooks";

export default function Audit() {
  const { data, isLoading } = useTransactions();
  const logs = data?.items ?? [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Compliance & Audit</h1>
      <p className="text-sm text-muted-foreground">
        Track every transfer and sale flowing into your PAYGW and GST accounts. Download the full audit trail for regulators.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-300 rounded-lg">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left border-b">Date</th>
              <th className="px-4 py-2 text-left border-b">Source</th>
              <th className="px-4 py-2 text-left border-b">Description</th>
              <th className="px-4 py-2 text-right border-b">Amount</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6">
                  <Skeleton height={18} />
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  No activity recorded yet.
                </td>
              </tr>
            ) : (
              logs.map(item => (
                <tr key={`${item.date}-${item.description}`} className="border-t">
                  <td className="px-4 py-2">{item.date}</td>
                  <td className="px-4 py-2 capitalize">{item.source}</td>
                  <td className="px-4 py-2">{item.description}</td>
                  <td className="px-4 py-2 text-right">${item.amount.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <button className="button" style={{ marginTop: 16 }}>Download Full Log</button>
    </div>
  );
}
