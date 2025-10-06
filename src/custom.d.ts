import type { AuthenticatedUser } from "./types/auth";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthenticatedUser;
      log: (level: string, message: string, meta?: Record<string, unknown>) => void;
    }
  }
}

export {};
