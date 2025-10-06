import type { AuthClaims } from "../auth/types";

declare global {
  namespace Express {
    interface Request {
      user?: AuthClaims;
      requestId: string;
    }
  }
}

export {};
