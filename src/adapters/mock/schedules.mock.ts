import { SchedulesPort } from "../../ports/schedules";

export class PlaceholderSchedules implements SchedulesPort {
  paygw(taxableCents: number) {
    return Math.round(taxableCents * 0.2);
  }

  gst(taxableCents: number) {
    return Math.round(taxableCents / 11);
  }
}
