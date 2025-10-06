import type { DbClient } from "../db/pool";
import { merkleRootHex, sha256Hex } from "../crypto/merkle";

export interface LedgerProofs {
  merkle_root: string;
  running_balance_hash: string;
}

export async function computeLedgerProofs(client: DbClient, abn: string, taxType: string, periodId: string): Promise<LedgerProofs> {
  const { rows } = await client.query<{
    amount_cents: string | number;
    balance_after_cents: string | number;
    bank_receipt_hash: string | null;
    hash_after: string | null;
    id: number;
  }>(
    `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, hash_after
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id ASC`,
    [abn, taxType, periodId]
  );

  if (!rows.length) {
    const emptyHash = sha256Hex("");
    return { merkle_root: emptyHash, running_balance_hash: emptyHash };
  }

  const leaves = rows.map((row) =>
    JSON.stringify({
      id: row.id,
      amount_cents: Number(row.amount_cents),
      balance_after_cents: Number(row.balance_after_cents),
      bank_receipt_hash: row.bank_receipt_hash ?? "",
      hash_after: row.hash_after ?? "",
    })
  );

  const merkle_root = merkleRootHex(leaves);
  const running_balance_hash = rows[rows.length - 1].hash_after ?? sha256Hex(leaves[leaves.length - 1]);
  return { merkle_root, running_balance_hash };
}
