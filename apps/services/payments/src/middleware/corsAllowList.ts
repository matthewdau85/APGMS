import { Request, Response, NextFunction } from "express";

function parseAllowList() {
  const raw = process.env.CORS_ALLOW_LIST || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function corsAllowList() {
  const allowList = parseAllowList();
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get("origin") || req.get("Origin");
    if (origin && allowList.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", req.get("Access-Control-Request-Headers") || "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    return next();
  };
}
