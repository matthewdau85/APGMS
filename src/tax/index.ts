import { ATOSchedules } from "./atoSchedules";
import { PlaceholderSchedules } from "./placeholderSchedules";

export const schedules =
  process.env.FEATURE_ATO_TABLES === "true" ? new ATOSchedules() : new PlaceholderSchedules();
