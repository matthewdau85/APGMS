import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const SECRET = process.env.API_JWT_SECRET || "dev-secret-change-me";
export type Role = "auditor"|"accountant"|"admin";

export function auth(required?: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ error: "unauthorized" });
    try {
      const payload = jwt.verify(token, SECRET) as { sub: string; roles?: Role[] };
      (req as any).user = payload;
      if (required && required.length) {
        const roles = new Set(payload.roles || []);
        const ok = required.some(r => roles.has(r));
        if (!ok) return res.status(403).json({ error: "forbidden" });
      }
      next();
    } catch { return res.status(401).json({ error: "unauthorized" }); }
  };
}
