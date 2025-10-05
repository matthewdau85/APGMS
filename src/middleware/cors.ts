import type { RequestHandler } from "express";

export interface CorsOptions {
  origins: string[];
}

export function cors(options: CorsOptions): RequestHandler {
  const allowed = options.origins.map((origin) => origin.trim()).filter(Boolean);
  return (req, res, next) => {
    res.setHeader("Vary", "Origin");
    const origin = req.headers.origin;
    const isAllowed = !origin || allowed.includes(origin);

    if (origin) {
      if (!isAllowed) {
        return res.status(403).json({ error: "CORS_ORIGIN_FORBIDDEN" });
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
    }

    res.setHeader("Access-Control-Allow-Credentials", "true");
    const requestHeaders = req.headers["access-control-request-headers"];
    if (requestHeaders) {
      res.setHeader("Access-Control-Allow-Headers", String(requestHeaders));
    } else {
      res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    return next();
  };
}
