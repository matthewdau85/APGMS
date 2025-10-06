declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
    interface Locals {
      requestId?: string;
    }
  }
}

export {};
