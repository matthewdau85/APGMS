import { withTransaction } from "../persistence/db";
import {
  enqueueDlq,
  insertPayrollEvent,
  insertPosEvent,
  payrollTotalsForPeriod,
  posTotalsForPeriod,
  orderedPayrollEvents,
  orderedPosEvents,
} from "../persistence/ingestionRepository";

export async function recordPayrollEvents(events: Parameters<typeof insertPayrollEvent>[0][]) {
  if (events.length === 0) return;
  await withTransaction(async (client) => {
    for (const event of events) {
      await insertPayrollEvent(event, client);
    }
  });
}

export async function recordPosEvents(events: Parameters<typeof insertPosEvent>[0][]) {
  if (events.length === 0) return;
  await withTransaction(async (client) => {
    for (const event of events) {
      await insertPosEvent(event, client);
    }
  });
}

export async function dlq(source: string, eventId: string | null, payload: unknown, error: string) {
  await enqueueDlq(source, eventId, payload, error);
}

export const totals = {
  payroll: payrollTotalsForPeriod,
  pos: posTotalsForPeriod,
};

export const orderedEvents = {
  payroll: orderedPayrollEvents,
  pos: orderedPosEvents,
};

