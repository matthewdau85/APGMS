declare module "*.svg" {
  const content: string;
  export default content;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module "pg" {
  class Pool {
    constructor(config?: any);
    connect(): Promise<any>;
    query<T = any>(queryText: string, values?: any[]): Promise<{ rows: T[]; rowCount?: number }>;
    end(): Promise<void>;
  }
  export { Pool };
  export default Pool;
}

declare module "../../../apps/services/payments/src/routes/balance.js" {
  import type { RequestHandler } from "express";
  export const balance: RequestHandler;
}

declare module "../../../apps/services/payments/src/routes/ledger.js" {
  import type { RequestHandler } from "express";
  export const ledger: RequestHandler;
}

declare module "../../../apps/services/payments/src/routes/deposit.js" {
  import type { RequestHandler } from "express";
  export const deposit: RequestHandler;
}

declare module "../../../apps/services/payments/src/middleware/rptGate.js" {
  import type { RequestHandler } from "express";
  export const rptGate: RequestHandler;
}

declare module "../../../apps/services/payments/src/routes/payAto.js" {
  import type { RequestHandler } from "express";
  export const payAtoRelease: RequestHandler;
}
