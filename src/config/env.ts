const REQUIRED_SECRETS = [
  "AUTH_ISSUER_BASE_URL",
  "AUTH_AUDIENCE",
  "SERVICE_SIGNING_KEY",
];

export function validateEnv() {
  const missing = REQUIRED_SECRETS.filter((key) => {
    const value = process.env[key];
    return !value || value.trim().length === 0;
  });

  if (missing.length > 0) {
    console.error(`Missing required secrets: ${missing.join(", ")}`);
    process.exit(1);
  }
}
