declare module "*.svg" {
  const content: string;
  export default content;
}

declare module "pg" {
  export interface QueryResultRow {
    [column: string]: unknown;
  }

  export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
    rows: T[];
    rowCount: number;
  }

  export class Client {
    constructor(config?: unknown);
    connect(): Promise<void>;
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[]
    ): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }

  export class Pool {
    constructor(config?: unknown);
    connect(): Promise<Client & { release(): void }>;
    query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[]
    ): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }

  export type PoolClient = Client & { release(): void };

  const pg: {
    Pool: typeof Pool;
    Client: typeof Client;
  };

  export default pg;
}
