import { v5 as uuidv5 } from "uuid";

const DEFAULT_NAMESPACE = "4b14e4f2-13f1-4d69-b0b0-6aefc9bc4034";
const NAMESPACE = process.env.PERIOD_UUID_NAMESPACE || DEFAULT_NAMESPACE;

export function periodUuid(abn: string, taxType: string, periodId: string) {
  return uuidv5(`${abn}:${taxType}:${periodId}`, NAMESPACE);
}
