import { Pool } from "pg";

/**
 * Shared Postgres connection pool for the API server.
 *
 * The Pool constructor will read connection configuration
 * from the standard PG environment variables (PGHOST, etc.)
 * so we don't need to pass explicit options here.
 */
export const pool = new Pool();

export type DbPool = Pool;
