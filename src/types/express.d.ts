import type { JWTPayload } from "jose";

declare global {
  namespace Express {
    interface AuthContext {
      sub: string;
      roles: string[];
      claims: JWTPayload;
    }

    interface Request {
      auth?: AuthContext;
      rawBody?: string;
      scrubbedLog?: {
        body?: unknown;
        query?: unknown;
      };
    }
  }
}

export {};
