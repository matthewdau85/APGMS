import { Schedules } from "./ports";

export class PlaceholderSchedules implements Schedules {
  paygw(taxableCents: number, _frequency: "weekly" | "fortnightly" | "monthly"): number {
    return Math.round(taxableCents * 0.2);
  }

  gst(taxableCents: number): number {
    return Math.round(taxableCents / 11);
  }

  penalty(_underpaidCents: number, _daysLate: number): number {
    return 0;
  }
}
