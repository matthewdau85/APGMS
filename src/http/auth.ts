import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const SECRET = process.env.API_JWT_SECRET || "dev-secret-change-me";

export type Role = "auditor" | "accountant" | "admin";

export function auth(required?: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const t = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!t) return res.status(401).json({ error: "unauthorized" });
    try {
      const p = jwt.verify(t, SECRET) as { sub: string; roles?: Role[] };
      (req as any).user = p;
      if (
        required &&
        required.length &&
        !(p.roles || []).some((r) => required.includes(r))
      ) {
        return res.status(403).json({ error: "forbidden" });
      }
      next();
    } catch {
      res.status(401).json({ error: "unauthorized" });
    }
  };
}
