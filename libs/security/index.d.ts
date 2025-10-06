import type { NextFunction, Request, Response } from "express";

export interface Logger {
  info(message: string | Record<string, unknown>, context?: string): void;
  error(message: string | Record<string, unknown>, context?: string): void;
  warn?(message: string | Record<string, unknown>, context?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(options?: { bindings?: Record<string, unknown> }): Logger;
export function requestLogger(logger: Logger): (req: Request, res: Response, next: NextFunction) => void;
export function securityHeaders(): (req: Request, res: Response, next: NextFunction) => void;
export function corsMiddleware(options?: { origins?: string[] }): (req: Request, res: Response, next: NextFunction) => void;
export function rateLimiter(options?: { limit?: number; windowMs?: number }): (req: Request, res: Response, next: NextFunction) => void;
export function verifyJwt(token: string, secret: string): any;
export function signJwt(payload: any, secret: string, options?: { expiresIn?: number }): string;
export function checkTotp(token: string, secret: string, window?: number): boolean;
export function generateTotp(secret: string, timestamp?: number, step?: number, digits?: number): string;
