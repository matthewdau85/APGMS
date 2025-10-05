declare module "pg" {
  import { EventEmitter } from "events";

  export interface QueryResultRow {
    [column: string]: unknown;
  }

  export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
    command: string;
    rowCount: number;
    oid: number;
    rows: T[];
    fields: any[];
  }

  export class PoolClient extends EventEmitter {
    query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
    release(err?: Error): void;
  }

  export class Pool extends EventEmitter {
    constructor(config?: Record<string, unknown>);
    connect(): Promise<PoolClient>;
    query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }

  const pg: { Pool: typeof Pool };
  export default pg;
  export { pg };
}
