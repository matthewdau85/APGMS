import { readFileSync } from "fs";

export function loadEvidenceSample(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}
