import { postJson } from "./taxEngineClient";

type PenaltyResponse = { penalty: number };

export async function calculatePenalties(daysLate: number, amountDue: number, annualRate?: number): Promise<number> {
  const payload: Record<string, number> = {
    daysLate,
    amountDue,
  };
  if (annualRate !== undefined) {
    payload.annualRate = annualRate;
  }
  const result = await postJson<PenaltyResponse>("/calculate/penalties", payload);
  return result.penalty ?? 0;
}
