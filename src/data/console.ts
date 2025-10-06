// src/data/console.ts
export type ComplianceSnapshot = {
  lodgmentsUpToDate: boolean;
  paymentsUpToDate: boolean;
  overallCompliance: number;
  lastBasLodged: string;
  nextDueDate: string;
  outstandingLodgments: string[];
  outstandingAmounts: Array<{ taxType: string; amountCents: number; description?: string }>;
};

const complianceSnapshot: ComplianceSnapshot = {
  lodgmentsUpToDate: false,
  paymentsUpToDate: false,
  overallCompliance: 65,
  lastBasLodged: "2025-05-29",
  nextDueDate: "2025-07-28",
  outstandingLodgments: ["Q4 FY23-24"],
  outstandingAmounts: [
    { taxType: "PAYGW", amountCents: 120000, description: "Withheld wages awaiting settlement" },
    { taxType: "GST", amountCents: 40000, description: "GST on sales" },
  ],
};

const basLineItems = [
  { code: "W1", label: "Gross wages", amountCents: 750000 },
  { code: "W2", label: "PAYGW withheld", amountCents: 185000 },
  { code: "G1", label: "Total sales", amountCents: 2500000 },
  { code: "1A", label: "GST on sales", amountCents: 250000 },
  { code: "1B", label: "GST on purchases", amountCents: 45000 },
];

const basHistory = [
  { period: "2025-03-31", paygwPaidCents: 160000, gstPaidCents: 110000, status: "On Time", daysLate: 0, penaltiesCents: 0 },
  { period: "2025-02-28", paygwPaidCents: 170000, gstPaidCents: 115000, status: "Late", daysLate: 3, penaltiesCents: 4500 },
  { period: "2025-01-31", paygwPaidCents: 165000, gstPaidCents: 112500, status: "Partial", daysLate: 0, penaltiesCents: 0 },
];

const settingsData = {
  profile: {
    abn: "12 345 678 901",
    legalName: "Example Pty Ltd",
    tradingName: "Example Vending",
    contacts: {
      email: "info@example.com",
      phone: "+61 2 3456 7890",
    },
  },
  accounts: [
    { id: "acct-1", name: "Main Business", bsb: "123-456", accountNumber: "11111111", type: "Operating" },
    { id: "acct-2", name: "PAYGW Saver", bsb: "123-456", accountNumber: "22222222", type: "PAYGW Buffer" },
  ],
  payrollProviders: ["MYOB", "QuickBooks"],
  salesChannels: ["Vend", "Square"],
  transfers: [
    { id: "transfer-1", type: "PAYGW", amountCents: 100000, frequency: "weekly", nextRun: "2025-06-05" },
  ],
  security: {
    twoFactor: true,
    smsAlerts: true,
  },
  notifications: {
    emailReminders: true,
    smsLodgmentReminders: false,
  },
};

const auditEntries = [
  { id: "log-2025-05-01", occurredAt: "2025-05-01T09:24:00+10:00", actor: "System", action: "Transferred $1,000 to PAYGW buffer" },
  { id: "log-2025-05-10", occurredAt: "2025-05-10T14:16:00+10:00", actor: "System", action: "Lodged BAS (Q3 FY24-25)" },
  { id: "log-2025-05-15", occurredAt: "2025-05-15T11:02:00+10:00", actor: "Admin", action: "Audit log downloaded" },
  { id: "log-2025-05-22", occurredAt: "2025-05-22T08:45:00+10:00", actor: "System", action: "Reminder sent: PAYGW payment due" },
  { id: "log-2025-06-05", occurredAt: "2025-06-05T07:10:00+10:00", actor: "Scheduler", action: "Scheduled PAYGW transfer" },
  { id: "log-2025-05-29", occurredAt: "2025-05-29T12:05:00+10:00", actor: "Admin", action: "BAS lodged (on time)" },
  { id: "log-2025-05-16", occurredAt: "2025-05-16T17:30:00+10:00", actor: "System", action: "GST payment made" },
];

export const consoleData = {
  complianceSnapshot,
  dashboard: {
    summary: complianceSnapshot,
  },
  bas: {
    compliance: complianceSnapshot,
    currentPeriod: {
      period: "Q4 FY23-24",
      lineItems: basLineItems,
    },
    history: basHistory,
  },
  settings: settingsData,
  audit: { entries: auditEntries },
};

export type ConsoleData = typeof consoleData;
