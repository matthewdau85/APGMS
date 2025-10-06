import type { PoolClient } from "pg";
import { sha256Hex, merkleRootHex } from "../crypto/merkle";

export interface LedgerState {
  merkleRoot: string;
  runningBalanceHash: string;
}

export async function computeLedgerState(
  client: PoolClient,
  abn: string,
  taxType: string,
  periodId: string
): Promise<LedgerState> {
  const { rows } = await client.query(
    `SELECT id, balance_after_cents, bank_receipt_hash
     FROM owa_ledger
     WHERE abn=$1 AND tax_type=$2 AND period_id=$3
     ORDER BY id ASC`,
    [abn, taxType, periodId]
  );

  const leaves: string[] = [];
  let prevHash = "";

  for (const row of rows) {
    const receipt = row.bank_receipt_hash ?? "";
    const balance = row.balance_after_cents != null ? String(row.balance_after_cents) : "0";
    const hash = sha256Hex(prevHash + receipt + balance);
    leaves.push(hash);
    prevHash = hash;
  }

  const merkleRoot = merkleRootHex(leaves);
  return { merkleRoot, runningBalanceHash: prevHash };
}
