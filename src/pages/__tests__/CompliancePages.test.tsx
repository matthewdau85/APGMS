import React from "react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { act, render, screen } from "@testing-library/react";
import Dashboard from "../Dashboard";
import BAS from "../BAS";
import {
  ComplianceClient,
  ComplianceProvider,
  ComplianceSelection,
  BalanceResponse,
  LedgerResponse,
  EvidenceResponse,
} from "../../context/ComplianceContext";

const selection: ComplianceSelection = {
  abn: "12345678901",
  taxType: "GST",
  periodId: "2025-09",
};

function renderWithClient(ui: React.ReactNode, client: ComplianceClient) {
  return render(
    <ComplianceProvider client={client} initialSelection={selection}>
      <MemoryRouter>{ui}</MemoryRouter>
    </ComplianceProvider>
  );
}

function buildSuccessfulFixtures() {
  const balance: BalanceResponse = {
    abn: selection.abn,
    taxType: selection.taxType,
    periodId: selection.periodId,
    balance_cents: 0,
    has_release: true,
  };

  const ledger: LedgerResponse = {
    abn: selection.abn,
    taxType: selection.taxType,
    periodId: selection.periodId,
    rows: [
      { id: 1, amount_cents: 50000, created_at: "2025-05-01T00:00:00Z" },
      { id: 2, amount_cents: 73456, created_at: "2025-05-15T00:00:00Z" },
      { id: 3, amount_cents: -123456, created_at: "2025-05-28T00:00:00Z" },
    ],
  };

  const evidence: EvidenceResponse = {
    rpt_payload: {
      period_id: selection.periodId,
      amount_cents: 123456,
      tax_type: selection.taxType,
      expiry_ts: "2025-07-28T00:00:00Z",
      created_at: "2025-05-28T00:00:00Z",
    },
    rpt_signature: "signature",
  };

  return { balance, ledger, evidence };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Compliance-enabled pages", () => {
  it("shows a loading state while fetching compliance data", async () => {
    const fixtures = buildSuccessfulFixtures();
    const balance = createDeferred<BalanceResponse>();
    const ledger = createDeferred<LedgerResponse>();
    const evidence = createDeferred<EvidenceResponse>();

    const client: ComplianceClient = {
      balance: () => balance.promise,
      ledger: () => ledger.promise,
      evidence: () => evidence.promise,
    };

    renderWithClient(<Dashboard />, client);

    expect(screen.getByText(/loading compliance data/i)).toBeInTheDocument();

    await act(async () => {
      balance.resolve(fixtures.balance);
      ledger.resolve(fixtures.ledger);
      evidence.resolve(fixtures.evidence);
    });

    expect(await screen.findByText(/Up to date ✅/)).toBeInTheDocument();
  });

  it("renders compliance insights once the API calls succeed", async () => {
    const fixtures = buildSuccessfulFixtures();
    const client: ComplianceClient = {
      balance: vi.fn().mockResolvedValue(fixtures.balance),
      ledger: vi.fn().mockResolvedValue(fixtures.ledger),
      evidence: vi.fn().mockResolvedValue(fixtures.evidence),
    };

    renderWithClient(<Dashboard />, client);

    expect(await screen.findByText(/Up to date ✅/)).toBeInTheDocument();
    expect(screen.getByText(/All paid ✅/)).toBeInTheDocument();
    expect(screen.getByText(/Compliance Score/i)).toBeInTheDocument();
    expect(screen.getByText(/Next BAS due by/i)).toBeInTheDocument();
  });

  it("surfaces API failures on the BAS page", async () => {
    const client: ComplianceClient = {
      balance: vi.fn().mockRejectedValue(new Error("boom")),
      ledger: vi.fn().mockResolvedValue({
        abn: selection.abn,
        taxType: selection.taxType,
        periodId: selection.periodId,
        rows: [],
      }),
      evidence: vi.fn().mockResolvedValue({}),
    };

    renderWithClient(<BAS />, client);

    expect(await screen.findByText(/Unable to load BAS overview/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
