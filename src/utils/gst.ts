import { GstInput } from "../types/tax";
import { postJson } from "./taxEngineClient";

type GstResponse = { gst: number };

export async function calculateGst({ saleAmount, exempt = false }: GstInput): Promise<number> {
  const payload = { amount: saleAmount, exempt };
  const result = await postJson<GstResponse>("/calculate/gst", payload);
  return result.gst ?? 0;
}
