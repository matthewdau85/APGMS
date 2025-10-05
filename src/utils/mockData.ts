// src/mockData.ts
// Demo data for the fictitious "Northern Rivers Creative Co" used across the app UI.
import type { BASHistory } from '../types/tax';

export const mockPayroll = [
  { employee: "Alice Nguyen", gross: 3200, withheld: 780 },
  { employee: "Bob Patel", gross: 4100, withheld: 980 },
  { employee: "Celia Ford", gross: 2850, withheld: 640 },
  { employee: "Diego Romero", gross: 3600, withheld: 860 },
  { employee: "Ella Zhang", gross: 5400, withheld: 1350 },
];

export const mockSales = [
  { id: "INV-001", amount: 18250, exempt: false },
  { id: "INV-002", amount: 9400, exempt: false },
  { id: "INV-003", amount: 7300, exempt: true },
  { id: "INV-004", amount: 15200, exempt: false },
  { id: "INV-005", amount: 4200, exempt: true },
];

// 👇 This line is the key: explicitly declare the array type!
export const mockBasHistory: BASHistory[] = [
  {
    period: new Date("2025-06-30"),
    paygwPaid: 21500,
    gstPaid: 14850,
    status: "On Time",
    daysLate: 0,
    penalties: 0,
  },
  {
    period: new Date("2025-03-31"),
    paygwPaid: 20560,
    gstPaid: 13920,
    status: "Late",
    daysLate: 7,
    penalties: 320,
  },
  {
    period: new Date("2024-12-31"),
    paygwPaid: 19875,
    gstPaid: 12540,
    status: "Partial",
    daysLate: 12,
    penalties: 210,
  },
  {
    period: new Date("2024-09-30"),
    paygwPaid: 18820,
    gstPaid: 11710,
    status: "Late",
    daysLate: 18,
    penalties: 740,
  },
  {
    period: new Date("2024-06-30"),
    paygwPaid: 17640,
    gstPaid: 11090,
    status: "On Time",
    daysLate: 0,
    penalties: 0,
  },
];
