import { PoolClient } from "pg";
import { getPool } from "../db/pool";
import { HttpError } from "../utils/errors";

export type Destination = {
  id: number;
  abn: string;
  rail: "EFT" | "BPAY";
  reference: string;
  account_bsb: string | null;
  account_number: string | null;
};

type Runner = PoolClient | ReturnType<typeof getPool>;

function runner(client?: PoolClient): Runner {
  return client ?? getPool();
}

export async function resolveDestination(abn: string, rail: "EFT" | "BPAY", reference: string, client?: PoolClient) {
  const q = runner(client);
  const { rows } = await q.query<Destination>(
    "select id, abn, rail, reference, account_bsb, account_number from remittance_destinations where abn=$1 and rail=$2 and reference=$3",
    [abn, rail, reference]
  );
  if (rows.length === 0) {
    throw new HttpError(403, "DEST_NOT_ALLOW_LISTED", "Destination not allow-listed", `No destination for rail ${rail} with reference ${reference}.`);
  }
  return rows[0];
}
