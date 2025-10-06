declare module "pg" {
  export interface QueryResultRow { [column: string]: unknown; }
  export interface QueryResult<R extends QueryResultRow = QueryResultRow> {
    rows: R[];
    rowCount: number;
  }
  export interface PoolClient {
    query<R extends QueryResultRow = QueryResultRow>(text: string, params?: any[]): Promise<QueryResult<R>>;
    release(): void;
  }
}
