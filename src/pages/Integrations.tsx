import React, { useState } from "react";

export default function Integrations() {
  const [invoiceAssist, setInvoiceAssist] = useState({
    docId: "INV-7842",
    supplier: "Acme Pty Ltd",
    invoiceNumber: "INV-7842",
    gstCode: "GST",
    amount: 242.4,
    confidence: 0.82,
    override: "",
    confirmed: false
  });

  function confirmIngest() {
    setInvoiceAssist(prev => ({ ...prev, confirmed: true }));
  }

  return (
    <div className="main-card space-y-6">
      <div>
        <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 12 }}>Integrations</h1>
        <p className="text-sm text-gray-600">
          Connect to payroll, POS, and document sources. ML Assist only pre-fills data; statutory postings remain deterministic.
        </p>
      </div>

      <section className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-emerald-800">Invoice Ingestion (Advisory)</h2>
            <p className="text-sm text-gray-600">
              ML Assist parsed invoice <strong>{invoiceAssist.docId}</strong> and suggests the GST split below. Operators must approve before it syncs to any ledger.
            </p>
          </div>
          <span className="inline-flex h-8 items-center rounded-full bg-amber-100 px-3 text-xs font-semibold text-amber-700">
            Advisory
          </span>
        </div>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="font-semibold text-gray-700">Supplier</p>
            <p className="text-gray-600">{invoiceAssist.supplier}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="font-semibold text-gray-700">Invoice #</p>
            <p className="text-gray-600">{invoiceAssist.invoiceNumber}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="font-semibold text-gray-700">GST Code</p>
            <p className="text-gray-600">{invoiceAssist.gstCode}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="font-semibold text-gray-700">Total Amount</p>
            <p className="text-gray-600">${invoiceAssist.amount.toFixed(2)}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">Confidence {Math.round(invoiceAssist.confidence * 100)}%. Explainability logs capture matched tokens for audit.</p>
        <textarea
          className="mt-3 w-full rounded border border-gray-300 p-3 text-sm"
          placeholder="Override note (e.g. update GST code before approval)"
          value={invoiceAssist.override}
          onChange={event => setInvoiceAssist(prev => ({ ...prev, override: event.target.value }))}
        />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={confirmIngest}
            disabled={invoiceAssist.confirmed}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
              invoiceAssist.confirmed
                ? "cursor-not-allowed bg-gray-200 text-gray-500"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            {invoiceAssist.confirmed ? "Decision logged" : "Confirm invoice import"}
          </button>
          <span className="text-xs text-gray-500">
            Overrides are stored and replayed to the ML Assist service for accountability.
          </span>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold">Connect to Providers</h3>
        <ul className="mt-3 space-y-2 text-sm">
          <li>MYOB (Payroll) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
          <li>QuickBooks (Payroll) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
          <li>Square (POS) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
          <li>Vend (POS) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
        </ul>
        <div style={{ marginTop: 24, fontSize: 15, color: "#888" }}>
          (More integrations coming soon.)
        </div>
      </section>
    </div>
  );
}
