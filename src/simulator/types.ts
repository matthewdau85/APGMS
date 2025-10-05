export type AdapterName = "bank" | "payto" | "payroll" | "pos";
export type AdapterMode = "success" | "insufficient" | "error";

export type AdapterModes = Record<AdapterName, AdapterMode>;

export interface AdapterEvent {
  id: string;
  ts: number;
  adapter: AdapterName;
  mode: AdapterMode;
  payload: unknown;
  response?: unknown;
  error?: string;
}
