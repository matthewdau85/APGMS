export const securityConfig = {
  jwtSecret: process.env.JWT_SECRET ?? "",
  jwtIssuer: process.env.JWT_ISSUER,
  jwtAudience: process.env.JWT_AUDIENCE,
  mfaSecret: process.env.MFA_TOTP_SECRET ?? "",
  sensitiveRateLimit: Number(process.env.SENSITIVE_RATE_LIMIT ?? 8),
  sensitiveRateWindowMs: Number(process.env.SENSITIVE_RATE_WINDOW_MS ?? 5 * 60 * 1000),
  logRetentionDays: Number(process.env.LOG_RETENTION_DAYS ?? 365),
  serviceName: process.env.SERVICE_NAME ?? "apgms-api",
};
