import { Pool } from "pg";
import type { PoolClient } from "pg";
import {
  matchAllowlistedDestination as matchRemittanceDestination,
  resolveDestinationByReference,
  type AllowlistDestination,
  type RemittanceDestination,
  type Rail,
} from "../../../../../libs/patent/remittance.js";

export type Dest = AllowlistDestination;

const connectionString = process.env.DATABASE_URL;
const defaultPool = new Pool(connectionString ? { connectionString } : undefined);

function getQueryer(db?: Pool | PoolClient | null): Pool | PoolClient {
  if (db) return db;
  return defaultPool;
}

export async function isAllowlisted(abn: string, dest: Dest, db?: Pool | PoolClient | null): Promise<boolean> {
  if (!abn || !dest) return false;
  const queryer = getQueryer(db);
  const match = await matchRemittanceDestination(queryer, abn, dest);
  return Boolean(match);
}

export async function findAllowlistedDestination(abn: string, dest: Dest, db?: Pool | PoolClient | null): Promise<RemittanceDestination | null> {
  const queryer = getQueryer(db);
  return matchRemittanceDestination(queryer, abn, dest);
}

export async function resolveAllowlistedReference(abn: string, rail: Rail, reference: string, db?: Pool | PoolClient | null): Promise<RemittanceDestination | null> {
  const queryer = getQueryer(db);
  return resolveDestinationByReference(queryer, abn, rail, reference);
}
