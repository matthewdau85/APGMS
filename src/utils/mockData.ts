import { calculatePenalties } from './penalties';
import type { BASHistory } from '../types/tax';

export const mockPayroll = [
  { employee: "Alice", gross: 3000, withheld: 750 },
  { employee: "Bob", gross: 3500, withheld: 850 },
];

export const mockSales = [
  { id: "INV-001", amount: 12000, exempt: false },
  { id: "INV-002", amount: 8000, exempt: true },
];

const febPenalty = Number(calculatePenalties(3, 1700 + 1150).toFixed(2));

export const mockBasHistory: BASHistory[] = [
  { period: new Date('2025-03-31'), paygwPaid: 1600, gstPaid: 1100, status: "On Time", daysLate: 0, penalties: 0 },
  { period: new Date('2025-02-28'), paygwPaid: 1700, gstPaid: 1150, status: "Late", daysLate: 3, penalties: febPenalty },
  { period: new Date('2025-01-31'), paygwPaid: 1650, gstPaid: 1125, status: "Partial", daysLate: 0, penalties: 0 }
];
