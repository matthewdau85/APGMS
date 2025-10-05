import React from "react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Dashboard from "../Dashboard";
import BAS from "../BAS";
import Settings from "../Settings";
import { AppProvider } from "../../context/AppContext";
import type { PeriodQuery } from "../../hooks/usePeriodData";

const query: PeriodQuery = { abn: "12345678901", taxType: "GST", periodId: "2025-09" };

const balanceResponse = {
  abn: query.abn,
  taxType: query.taxType,
  periodId: query.periodId,
  balance_cents: 123456,
  has_release: false,
};

const ledgerResponse = {
  abn: query.abn,
  taxType: query.taxType,
  periodId: query.periodId,
  rows: [
    {
      id: 1,
      amount_cents: 80000,
      balance_after_cents: 80000,
      bank_receipt_id: "rcpt:one",
      created_at: "2025-05-29T10:00:00.000Z",
    },
    {
      id: 2,
      amount_cents: -20000,
      balance_after_cents: 60000,
      release_uuid: "rel-123",
      created_at: "2025-05-30T10:00:00.000Z",
    },
  ],
};

const evidenceResponse = {
  rpt_payload: {
    period_id: query.periodId,
    amount_cents: 20000,
    anomaly_vector: { dup_rate: 0.03 },
  },
  anomaly_thresholds: { dup_rate: 0.01 },
  discrepancy_log: [{ message: "Ledger hash mismatch" }],
};

type FixtureMap = Record<string, unknown>;

const fixtures: FixtureMap = {};

function resetFixtures() {
  fixtures[buildKey("/api/balance", query)] = balanceResponse;
  fixtures[buildKey("/api/ledger", query)] = ledgerResponse;
  fixtures[buildKey("/api/evidence", query)] = evidenceResponse;
}

function buildKey(path: string, params: Record<string, string>) {
  const sorted = Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("&");
  return `${path}?${sorted}`;
}

function mockFetchSuccess() {
  return vi.spyOn(global, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = rawUrl.startsWith("http") ? new URL(rawUrl) : new URL(rawUrl, "http://localhost");
    const key = buildKey(parsed.pathname, Object.fromEntries(parsed.searchParams.entries()));
    const body = fixtures[key];
    if (!body) {
      throw new Error(`Unhandled request in test: ${parsed.pathname}${parsed.search}`);
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });
}

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <AppProvider params={query}>
      <MemoryRouter initialEntries={["/"]}>{ui}</MemoryRouter>
    </AppProvider>
  );
}

beforeEach(() => {
  resetFixtures();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("live compliance views", () => {
  it("renders dashboard totals and alerts from API data", async () => {
    mockFetchSuccess();

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText(/Outstanding Payments: \$1,234\.56/i)).toBeInTheDocument();
    expect(screen.getByText(/Vault balance:/i)).toHaveTextContent("$1,234.56");
    expect(screen.getByText(/Alerts/i).closest("div")).toHaveTextContent(/dup rate exceeded threshold/i);
  });

  it("renders BAS ledger rows with live balances", async () => {
    mockFetchSuccess();

    renderWithProviders(<BAS />);

    expect(await screen.findByText(/Reserved in tax vault/i)).toHaveTextContent("$1,234.56");
    expect(screen.getByRole("table")).toHaveTextContent("rcpt:one");
    expect(screen.getByRole("table")).toHaveTextContent("+\$800.00");
    expect(screen.getByRole("table")).toHaveTextContent("-\$200.00");
  });

  it("shows settings with refreshed vault balance", async () => {
    mockFetchSuccess();

    renderWithProviders(<Settings />);

    expect(await screen.findByText(/Vault balance:/i)).toHaveTextContent("$1,234.56");
    expect(screen.getByText(/Deposited this period:/i)).toHaveTextContent("$800.00");
  });

  it("surfaces API errors to the dashboard", async () => {
    vi.spyOn(global, "fetch").mockImplementation(() => Promise.reject(new Error("boom")));

    renderWithProviders(<Dashboard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/i);
  });
});
