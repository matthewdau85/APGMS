import { Schedules } from "./ports";

export class PlaceholderSchedules implements Schedules {
  paygw(t: number) {
    return Math.round(t * 0.2);
  }
  gst(t: number) {
    return Math.round(t / 11);
  }
  penalty() {
    return 0;
  }
}
