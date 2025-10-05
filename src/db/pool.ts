import { Pool, PoolClient, QueryResult } from "pg";

let activePool: Pool = new Pool();

export function setPool(pool: Pool) {
  activePool = pool;
}

function getActivePool(): Pool {
  return activePool;
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop: keyof Pool) {
    const real = getActivePool() as any;
    const value = real[prop];
    if (typeof value === "function") {
      return value.bind(real);
    }
    return value;
  }
}) as Pool;

export type Queryable = Pool | PoolClient;

export function getRunner(client?: PoolClient): Queryable {
  return client ?? pool;
}

export type QueryFunction = <T = any>(queryText: string, values?: any[]) => Promise<QueryResult<T>>;

export function createQuery(client?: PoolClient): QueryFunction {
  const runner = getRunner(client);
  return (queryText: string, values?: any[]) => runner.query(queryText, values);
}
