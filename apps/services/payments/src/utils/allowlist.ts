import { readFileSync } from "fs";

export type AllowListEntry = {
  abn: string;
  rail: "EFT" | "BPAY";
  reference: string;
};

export function loadAllowList(filePath: string): AllowListEntry[] {
  const text = readFileSync(filePath, "utf8");
  return JSON.parse(text) as AllowListEntry[];
}
