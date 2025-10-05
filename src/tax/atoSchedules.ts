import { Schedules } from "./ports";

export class ATOSchedules implements Schedules {
  paygw(taxableCents: number, frequency: "weekly" | "fortnightly" | "monthly"): number {
    const annual = taxableCents * (frequency === "weekly" ? 52 : frequency === "fortnightly" ? 26 : 12);
    let tax = 0;
    if (annual <= 1_820_000) tax = 0;
    else if (annual <= 4_500_000) tax = (annual - 1_820_000) * 0.19;
    else if (annual <= 12_000_000) tax = 509_200 + (annual - 4_500_000) * 0.325;
    else if (annual <= 18_000_000) tax = 2_946_700 + (annual - 12_000_000) * 0.37;
    else tax = 5_166_700 + (annual - 18_000_000) * 0.45;
    const divisor = frequency === "weekly" ? 52 : frequency === "fortnightly" ? 26 : 12;
    return Math.max(0, Math.round(tax / divisor));
  }

  gst(taxableCents: number): number {
    return Math.round(taxableCents / 11);
  }

  penalty(underpaidCents: number, daysLate: number): number {
    const interest = Math.round(underpaidCents * 0.00022 * daysLate);
    const latePenalty = underpaidCents > 0 ? Math.round(Math.min(underpaidCents * 0.2, 100_00)) : 0;
    return interest + latePenalty;
  }
}
