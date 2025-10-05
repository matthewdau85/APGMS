import { randomBytes } from "node:crypto";

import { __encryptForTests, clearSecretCache } from "../../src/utils/secretManager";

const masterKey = randomBytes(32).toString("base64");
process.env.KMS_MASTER_KEY = masterKey;

function setEncrypted(name: string, value: string) {
  process.env[`${name}_ENCRYPTED`] = __encryptForTests(value, masterKey);
}

const bankSigningSeed = randomBytes(32);
setEncrypted("BANK_API_SIGNING_KEY", bankSigningSeed.toString("base64"));
setEncrypted("BANK_API_CLIENT_SECRET", "bank-client-secret");
process.env.BANK_API_CLIENT_ID = "bank-client";
process.env.BANK_API_BASE_URL = "https://bank.example";
process.env.BANK_API_TOKEN_URL = "https://bank.example/oauth/token";
process.env.BANK_API_SCOPE = "transactions stp";

setEncrypted("PAYROLL_API_CLIENT_SECRET", "payroll-client-secret");
process.env.PAYROLL_API_CLIENT_ID = "payroll-client";
process.env.PAYROLL_API_BASE_URL = "https://payroll.example";
process.env.PAYROLL_API_TOKEN_URL = "https://payroll.example/oauth/token";
process.env.PAYROLL_API_SCOPE = "payroll.write";

setEncrypted("POS_API_KEY", "pos-api-key");
setEncrypted("POS_API_SHARED_SECRET", "pos-shared-secret");
process.env.POS_API_BASE_URL = "https://pos.example";

export function resetSecrets() {
  clearSecretCache();
}

export { bankSigningSeed };

