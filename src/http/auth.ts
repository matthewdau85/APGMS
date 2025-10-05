import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const SECRET = process.env.API_JWT_SECRET || "dev-secret-change-me";

export type Role = "auditor" | "accountant" | "admin";

type JwtPayload = {
  sub?: string;
  roles?: Role[] | string[];
  [key: string]: unknown;
};

export const auth = (roles?: Role[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

    if (!token) {
      return res.status(401).json({ error: "unauthorized" });
    }

    try {
      const payload = jwt.verify(token, SECRET) as JwtPayload;
      (req as any).user = payload;

      if (roles && roles.length) {
        const grantedRoles = Array.isArray(payload.roles) ? payload.roles : [];
        const allowed = grantedRoles.some((role) => roles.includes(role as Role));

        if (!allowed) {
          return res.status(403).json({ error: "forbidden" });
        }
      }

      return next();
    } catch (error) {
      return res.status(401).json({ error: "unauthorized" });
    }
  };
