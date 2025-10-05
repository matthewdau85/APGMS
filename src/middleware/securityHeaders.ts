import type { RequestHandler } from "express";

export function securityHeaders(): RequestHandler {
  const csp = ["default-src 'self'"].join("; ");
  return (_req, res, next) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    next();
  };
}
