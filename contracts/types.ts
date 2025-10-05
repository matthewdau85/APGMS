import type { ProviderName } from "./providers/index";

export type ProviderFlavor = "mock" | "real";

export interface ContractErrorShape {
  message: string;
  code: string;
  retriable: boolean;
  status?: number;
}

export interface ContractRunReport {
  provider: ProviderName;
  flavor: ProviderFlavor;
  responseTypes: Record<string, string>;
  errors: Record<string, ContractErrorShape>;
  idempotency: Record<string, string>;
  timeoutMs: number;
  retriableCodes: string[];
  notes?: string[];
  skipped?: boolean;
}

export interface ContractSpecContext {
  provider: ProviderName;
  flavor: ProviderFlavor;
  isReal: boolean;
  note(message: string): void;
  load<T>(): Promise<T>;
}

export type ContractSpec = (ctx: ContractSpecContext) => Promise<ContractRunReport>;

export function makeReport(
  ctx: ContractSpecContext,
  data: Omit<ContractRunReport, "provider" | "flavor" | "skipped" | "notes"> & {
    skipped?: boolean;
    notes?: string[];
  }
): ContractRunReport {
  const ctxNotes = (ctx as unknown as { __notes?: string[] }).__notes ?? [];
  const combinedNotes = data.notes ?? ctxNotes;
  return {
    provider: ctx.provider,
    flavor: ctx.flavor,
    skipped: data.skipped,
    responseTypes: data.responseTypes,
    errors: data.errors,
    idempotency: data.idempotency,
    timeoutMs: data.timeoutMs,
    retriableCodes: data.retriableCodes,
    notes: combinedNotes.length ? combinedNotes : undefined,
  };
}
