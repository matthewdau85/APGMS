import { SchedulesPort } from "../../ports/schedules";

export class ATOSchedules implements SchedulesPort {
  // NOTE: replace with actual ATO schedule tables later
  paygw(taxableCents: number, frequency: "weekly" | "fortnightly" | "monthly" = "monthly") {
    const annual = taxableCents * (frequency === "weekly" ? 52 : frequency === "fortnightly" ? 26 : 12);
    const taxAnnual = annual <= 1_820_000 ? 0 : Math.round((annual - 1_820_000) * 0.19);
    return Math.round(taxAnnual / (frequency === "weekly" ? 52 : frequency === "fortnightly" ? 26 : 12));
  }

  gst(taxableCents: number) {
    return Math.round(taxableCents / 11);
  }
}
