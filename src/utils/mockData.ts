// src/mockData.ts
import type { BASHistory } from '../types/tax';

export const mockPayroll = [
  { employee: "Alice", gross: 3000, withheld: 750 },
  { employee: "Bob", gross: 3500, withheld: 850 },
];

export const mockSales = [
  { id: "INV-001", amount: 12000, exempt: false },
  { id: "INV-002", amount: 8000, exempt: true },
];

// 👇 This line is the key: explicitly declare the array type!
export const mockBasHistory: BASHistory[] = [
  { period: new Date('2025-03-31'), paygwPaid: 1600, gstPaid: 1100, status: "On Time", daysLate: 0, penalties: 0 },
  { period: new Date('2025-02-28'), paygwPaid: 1700, gstPaid: 1150, status: "Late", daysLate: 3, penalties: 45 },
  { period: new Date('2025-01-31'), paygwPaid: 1650, gstPaid: 1125, status: "Partial", daysLate: 0, penalties: 0 }
];
