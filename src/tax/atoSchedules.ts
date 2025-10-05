import { Schedules } from "./ports";

export class ATOSchedules implements Schedules {
  paygw(t: number, f: "weekly" | "fortnightly" | "monthly") {
    const div = f === "weekly" ? 52 : f === "fortnightly" ? 26 : 12;
    const annual = t * div;
    let tax = 0;
    if (annual <= 1820000) tax = 0;
    else if (annual <= 4500000) tax = (annual - 1820000) * 0.19;
    else if (annual <= 12000000) tax = 509200 + (annual - 4500000) * 0.325;
    else if (annual <= 18000000) tax = 2946700 + (annual - 12000000) * 0.37;
    else tax = 5166700 + (annual - 18000000) * 0.45;
    return Math.max(0, Math.round(tax / div));
  }
  gst(t: number) {
    return Math.round(t / 11);
  }
  penalty(under: number, days: number) {
    return Math.round(under * 0.00022 * days);
  }
}
