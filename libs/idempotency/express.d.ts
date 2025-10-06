import type { Pool } from 'pg';
import type { Request, Response, NextFunction } from 'express';
import type { AxiosInstance } from 'axios';

declare interface ExpressIdempotencyOptions {
  pool: Pool;
  deriveKey?: (req: Request) => string | undefined;
  defaultTtlSeconds?: number;
  methods?: string[];
}

export declare function getIdempotencyKey(): string | undefined;
export declare function installFetchIdempotencyPropagation(): void;
export declare function attachAxiosIdempotencyInterceptor<T extends AxiosInstance>(instance: T): T;
export declare function derivePayoutKey(body: any): string | undefined;
export declare function createExpressIdempotencyMiddleware(options: ExpressIdempotencyOptions): (req: Request, res: Response, next: NextFunction) => void;

declare const _default: {
  getIdempotencyKey: typeof getIdempotencyKey;
  installFetchIdempotencyPropagation: typeof installFetchIdempotencyPropagation;
  attachAxiosIdempotencyInterceptor: typeof attachAxiosIdempotencyInterceptor;
  createExpressIdempotencyMiddleware: typeof createExpressIdempotencyMiddleware;
  derivePayoutKey: typeof derivePayoutKey;
};

export default _default;
