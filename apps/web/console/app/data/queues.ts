export type QueueId = "pending-anomalies" | "unreconciled-bank-lines" | "stuck-transitions";

export interface RptDetails {
  decodedJws: string;
  evidenceSet: Array<{
    id: string;
    capturedAt: string;
    summary: string;
  }>;
  ratesVersion: string;
}

export interface QueueItem {
  id: string;
  subject: string;
  status: "open" | "investigating" | "waiting";
  updatedAt: string;
  rpt: RptDetails;
}

export interface QueueDefinition {
  id: QueueId;
  title: string;
  description: string;
  items: QueueItem[];
}

export const queues: QueueDefinition[] = [
  {
    id: "pending-anomalies",
    title: "Pending Anomalies",
    description: "Signals that need rapid anomaly triage before settlement.",
    items: [
      {
        id: "pa-2048",
        subject: "Spike in GST on merchant 12345678901",
        status: "investigating",
        updatedAt: "2025-10-04T09:15:00Z",
        rpt: {
          decodedJws: "{\n  \"subject\": \"merchant-12345678901\",\n  \"anomaly_score\": 0.94,\n  \"ingested_at\": \"2025-10-04T09:11:48Z\"\n}",
          evidenceSet: [
            {
              id: "evt-771",
              capturedAt: "2025-10-04T08:59:21Z",
              summary: "Daily GST variance exceeded control limit by 24%",
            },
            {
              id: "evt-774",
              capturedAt: "2025-10-04T09:02:45Z",
              summary: "Rate change request submitted without approval",
            },
          ],
          ratesVersion: "rates_v5.14.2",
        },
      },
      {
        id: "pa-2051",
        subject: "Manual override scheduled for partner AUS-COMM",
        status: "open",
        updatedAt: "2025-10-04T08:20:00Z",
        rpt: {
          decodedJws: "{\n  \"subject\": \"partner-AUS-COMM\",\n  \"override\": true\n}",
          evidenceSet: [
            {
              id: "evt-801",
              capturedAt: "2025-10-04T08:14:00Z",
              summary: "Override created by automation",
            },
          ],
          ratesVersion: "rates_v5.14.0",
        },
      },
    ],
  },
  {
    id: "unreconciled-bank-lines",
    title: "Unreconciled Bank Lines",
    description: "Bank statement lines awaiting reconciliation with ledger.",
    items: [
      {
        id: "ubl-3102",
        subject: "Missing credit for payout batch 8821",
        status: "waiting",
        updatedAt: "2025-10-03T22:02:00Z",
        rpt: {
          decodedJws: "{\n  \"batch_id\": 8821,\n  \"expected_amount\": 128762.22\n}",
          evidenceSet: [
            {
              id: "evt-990",
              capturedAt: "2025-10-03T21:54:00Z",
              summary: "Ledger payout exported",
            },
            {
              id: "evt-991",
              capturedAt: "2025-10-03T21:58:00Z",
              summary: "Bank feed missing credit line",
            },
          ],
          ratesVersion: "rates_v5.13.8",
        },
      },
      {
        id: "ubl-3105",
        subject: "Duplicate debit flagged on bank feed",
        status: "open",
        updatedAt: "2025-10-04T01:47:00Z",
        rpt: {
          decodedJws: "{\n  \"transaction_id\": \"bnk-3901\",\n  \"type\": \"debit\",\n  \"duplicated\": true\n}",
          evidenceSet: [
            {
              id: "evt-1001",
              capturedAt: "2025-10-04T01:40:12Z",
              summary: "Debit recorded twice in bank feed",
            },
          ],
          ratesVersion: "rates_v5.13.8",
        },
      },
    ],
  },
  {
    id: "stuck-transitions",
    title: "Stuck Transitions",
    description: "Workflow transitions that have not advanced in SLA window.",
    items: [
      {
        id: "st-4401",
        subject: "Onboarding transition awaiting compliance upload",
        status: "waiting",
        updatedAt: "2025-10-04T05:09:00Z",
        rpt: {
          decodedJws: "{\n  \"workflow\": \"merchant-onboarding\",\n  \"state\": \"awaiting_compliance\"\n}",
          evidenceSet: [
            {
              id: "evt-1203",
              capturedAt: "2025-10-04T05:02:11Z",
              summary: "Compliance team SLA exceeded by 2h",
            },
          ],
          ratesVersion: "rates_v5.12.0",
        },
      },
      {
        id: "st-4402",
        subject: "Rate card publication stuck in approval",
        status: "investigating",
        updatedAt: "2025-10-04T03:44:00Z",
        rpt: {
          decodedJws: "{\n  \"workflow\": \"rate-publication\",\n  \"state\": \"awaiting_exec_signoff\"\n}",
          evidenceSet: [
            {
              id: "evt-1210",
              capturedAt: "2025-10-04T03:30:00Z",
              summary: "Executive approver PTO noted",
            },
          ],
          ratesVersion: "rates_v5.11.6",
        },
      },
    ],
  },
];
