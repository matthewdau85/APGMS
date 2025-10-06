import { createHash } from "crypto";

export function sha256Hex(input: Buffer | string): string {
  const h = createHash("sha256");
  h.update(input);
  return h.digest("hex");
}

export function merkleRootHex(leaves: string[]): string {
  if (leaves.length === 0) return sha256Hex("");
  let level = leaves.map((x) => sha256Hex(x));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : a;
      next.push(sha256Hex(a + b));
    }
    level = next;
  }
  return level[0];
}

export function buildMerkleRoot(payloads: string[]): string {
  return merkleRootHex(payloads);
}
