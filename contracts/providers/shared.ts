import { hashKey } from "../utils";
import type { ContractErrorShape } from "../types";

export function makeError(
  code: string,
  message: string,
  retriable = false,
  status?: number
): ContractErrorShape {
  return { code, message, retriable, status };
}

export function makeIdempotencyKey(parts: (string | number)[]): string {
  return hashKey(parts);
}

export function isoNow(): string {
  return new Date().toISOString();
}
