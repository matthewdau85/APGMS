import React from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import App from "./App";
import type { BasSummaryResponse, ConsoleApi, ConsoleStatusResponse, QueuesResponse, EvidenceResponse } from "./api/client";
import { renderWithProviders } from "./test-utils";

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf-8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createApi(overrides: {
  status?: ConsoleStatusResponse;
  bas?: BasSummaryResponse;
  queues?: QueuesResponse;
  evidence?: EvidenceResponse;
}): ConsoleApi {
  const status: ConsoleStatusResponse =
    overrides.status ?? ({ mode: "MOCK", kill_switch: { active: false, reason: null } } as ConsoleStatusResponse);
  const bas: BasSummaryResponse =
    overrides.bas ?? ({
      abn: "123456789",
      period_id: "2024Q4",
      rates_version: "2024.09",
      totals: [
        { code: "GST", amount_cents: 150000 },
        { code: "PAYGW", amount_cents: 85000 },
        { code: "NET", amount_cents: 235000 },
      ],
      issue_rpt: { allowed: true },
    } as BasSummaryResponse);
  const queues: QueuesResponse =
    overrides.queues ?? ({
      anomalies: [],
      unreconciled: [],
    } as QueuesResponse);
  const evidence: EvidenceResponse =
    overrides.evidence ?? ({ compact_jws: `${base64UrlEncode("{}")}.${base64UrlEncode("{}")}.sig` } as EvidenceResponse);

  return {
    getConsoleStatus: vi.fn().mockResolvedValue(status),
    getBasSummary: vi.fn().mockResolvedValue(bas),
    getQueues: vi.fn().mockResolvedValue(queues),
    getEvidence: vi.fn().mockResolvedValue(evidence),
  } satisfies ConsoleApi;
}

describe("Console App", () => {
  it("renders mode pill with engine mode", async () => {
    const api = createApi({ status: { mode: "SHADOW", kill_switch: { active: false, reason: null } } });
    renderWithProviders(<App />, { api });

    expect(await screen.findByLabelText(/engine mode shadow/i)).toBeInTheDocument();
  });

  it("disables Issue RPT with reason when blocked", async () => {
    const api = createApi({
      bas: {
        abn: "123",
        period_id: "2024Q4",
        rates_version: "2024.10",
        totals: [
          { code: "GST", amount_cents: 100_00 },
          { code: "PAYGW", amount_cents: 50_00 },
        ],
        issue_rpt: { allowed: false, reason: "blocked_by_anomaly" },
      },
    });
    renderWithProviders(<App />, { api });

    const button = await screen.findByRole("button", { name: /issue rpt/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/blocked_by_anomaly/i)).toBeInTheDocument();
  });

  it("shows merkle root and trace id after decoding evidence token", async () => {
    const payload = JSON.stringify({ merkle_root: "abc123", trace_id: "trace-789" });
    const compact = `${base64UrlEncode(JSON.stringify({ alg: "HS256" }))}.${base64UrlEncode(payload)}.${base64UrlEncode("sig")}`;
    const api = createApi({ evidence: { compact_jws: compact } });
    renderWithProviders(<App />, { api });

    const openButton = await screen.findByRole("button", { name: /view evidence token/i });
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(screen.getByText(/merkle root/i)).toBeInTheDocument();
      expect(screen.getByText(/abc123/)).toBeInTheDocument();
      expect(screen.getByText(/trace-789/)).toBeInTheDocument();
    });
  });
});
