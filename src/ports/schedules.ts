export interface SchedulesPort {
  paygw(
    taxableCents: number,
    frequency: "weekly" | "fortnightly" | "monthly"
  ): number;
  gst(taxableCents: number): number;
}
