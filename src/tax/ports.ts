export interface Schedules {
  paygw(taxableCents: number, frequency: "weekly" | "fortnightly" | "monthly"): number;
  gst(taxableCents: number): number;
  penalty(underCents: number, daysLate: number): number;
}
