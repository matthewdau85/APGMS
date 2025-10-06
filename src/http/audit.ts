import { Request, Response, NextFunction } from "express";
import { getPool } from "../db/pool";

export function audit(action: string, pick: (req: Request) => any) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const actor = (req as any).user?.sub || "anonymous";
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      await getPool().query(
        `insert into audit_events (actor, action, target, ip, details) values ($1,$2,$3,$4,$5)`,
        [actor, action, req.originalUrl, String(ip || ""), pick(req) ?? {}]
      );
    } catch {
      /* swallow */
    }
    next();
  };
}
