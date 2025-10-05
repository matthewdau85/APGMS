export interface Schedules {
  paygw(taxableCents: number, frequency: "weekly" | "fortnightly" | "monthly"): number;
  gst(taxableCents: number): number;
  penalty(underpaidCents: number, daysLate: number): number;
}
