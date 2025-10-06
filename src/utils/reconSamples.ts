export interface ReconEventSample {
  id: string;
  amount: number;
  isoTimestamp: string;
  channel: "portal" | "api" | "file" | "sftp";
  payer_hash: string;
  CRN_valid: boolean;
  period_state: "OPEN" | "CLOSED" | "OVERDUE" | "AMENDED";
}

export const reconSamples: ReconEventSample[] = [
  {
    id: "pay-2025-0001",
    amount: 4820.25,
    isoTimestamp: "2025-05-28T00:15:00+10:00",
    channel: "portal",
    payer_hash: "payer:alpha",
    CRN_valid: true,
    period_state: "OPEN",
  },
  {
    id: "pay-2025-0002",
    amount: 4820.25,
    isoTimestamp: "2025-05-28T00:19:00+10:00",
    channel: "portal",
    payer_hash: "payer:alpha",
    CRN_valid: true,
    period_state: "OPEN",
  },
  {
    id: "dep-2025-0003",
    amount: 1780.0,
    isoTimestamp: "2025-05-28T10:04:00+10:00",
    channel: "api",
    payer_hash: "payer:bravo",
    CRN_valid: true,
    period_state: "OPEN",
  },
  {
    id: "pay-2025-0004",
    amount: 1875.5,
    isoTimestamp: "2025-05-27T16:31:00+10:00",
    channel: "api",
    payer_hash: "payer:charlie",
    CRN_valid: true,
    period_state: "CLOSED",
  },
  {
    id: "pay-2025-0005",
    amount: 6225.0,
    isoTimestamp: "2025-05-26T08:12:00+10:00",
    channel: "file",
    payer_hash: "payer:delta",
    CRN_valid: false,
    period_state: "OVERDUE",
  },
  {
    id: "pay-2025-0006",
    amount: 96000,
    isoTimestamp: "2025-05-29T22:45:00+10:00",
    channel: "sftp",
    payer_hash: "payer:echo",
    CRN_valid: false,
    period_state: "AMENDED",
  },
  {
    id: "pay-2025-0007",
    amount: 1950.4,
    isoTimestamp: "2025-05-25T11:20:00+10:00",
    channel: "api",
    payer_hash: "payer:foxtrot",
    CRN_valid: true,
    period_state: "OPEN",
  },
  {
    id: "pay-2025-0008",
    amount: 4820.25,
    isoTimestamp: "2025-05-28T00:18:00+10:00",
    channel: "portal",
    payer_hash: "payer:alpha",
    CRN_valid: true,
    period_state: "OPEN",
  },
];
