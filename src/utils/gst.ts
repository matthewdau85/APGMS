import {
  BasSummary,
  GstEvent,
  GstEventClassification,
  GstInput,
  ReportingPeriod,
} from "../types/tax";
import { gstModule } from "./gstModule";

export function calculateGst(input: GstInput): number {
  return gstModule.calculateSimpleGst(input);
}

export function aggregateBas(events: GstEvent[], period: ReportingPeriod): BasSummary {
  return gstModule.aggregate(events, period);
}

export function classifyGstEvent(event: GstEvent): GstEventClassification {
  return gstModule.classify(event);
}

export { gstModule };
