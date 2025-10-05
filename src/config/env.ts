import "dotenv/config";
import { cleanEnv, str, url, bool, num } from "envalid";

export const env = cleanEnv(process.env, {
  NODE_ENV:               str({ choices: ["development","test","production"], default: "development" }),
  PORT:                   num({ default: 8080 }),
  DATABASE_URL:           str(),
  LOG_LEVEL:              str({ default: "info" }),
  RPT_ED25519_SECRET_BASE64: str(),        // REQUIRED for RPT signing
  MTLS_CERT:              str({ default: "" }),
  MTLS_KEY:               str({ default: "" }),
  MTLS_CA:                str({ default: "" }),
  ALLOWLIST_ABNS:         str({ default: "" }),
});
