import { Pool } from "pg";

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DatabasePool {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
}

let sharedPool: DatabasePool | null = null;

export function getPool(): DatabasePool {
  if (!sharedPool) {
    sharedPool = new Pool();
  }
  return sharedPool;
}

export function setPool(custom: DatabasePool) {
  sharedPool = custom;
}
