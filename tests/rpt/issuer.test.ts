import test from "node:test";
import assert from "node:assert/strict";

const issuerModuleUrl = new URL("../../src/rpt/issuer.ts", import.meta.url).href;
const issuerModulePromise = import(issuerModuleUrl);

const SECRET_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+Pw==";

test("issueRPT persists a signed payload when the secret is configured", async (t) => {
  const issuerModule = await issuerModulePromise;
  const { issueRPT, __testHooks, __resetIssuerSecretForTest } = issuerModule;

  __testHooks.reset();
  __resetIssuerSecretForTest();

  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let poolConstructed = 0;

  __testHooks.setPoolFactory(() => {
    poolConstructed += 1;
    let call = 0;
    return {
      async query(sql: string, params: unknown[]) {
        queries.push({ sql, params });
        if (call === 0) {
          call += 1;
          return {
            rowCount: 1,
            rows: [
              {
                id: 42,
                abn: "123456789",
                tax_type: "GST",
                period_id: "2024Q4",
                state: "CLOSING",
                final_liability_cents: "1000",
                credited_to_owa_cents: "1000",
                merkle_root: "abc",
                running_balance_hash: "def",
                anomaly_vector: { foo: 1 }
              }
            ]
          };
        }
        return { rowCount: 1, rows: [] };
      }
    } as any;
  });

  let signArgs: { payload: any; key: Uint8Array } | null = null;
  __testHooks.setSignFn((payload, key) => {
    signArgs = { payload, key };
    return "signed-token";
  });
  __testHooks.setExceedsFn(() => false);

  process.env.RPT_ED25519_SECRET_BASE64 = SECRET_B64;
  process.env.ATO_PRN = "ATO-PRN";

  const result = await issueRPT("123456789", "GST", "2024Q4", { epsilon_cents: 100 });

  assert.equal(poolConstructed, 1, "expected a pool to be constructed exactly once");
  assert.ok(signArgs, "signRpt should have been invoked");
  assert.equal(signArgs!.key.length, 64, "decoded key should be 64 bytes");
  assert.equal(result.signature, "signed-token");
  assert.equal(queries.length, 3, "expected three DB operations (select, insert, update)");

  t.after(() => {
    __testHooks.reset();
    delete process.env.RPT_ED25519_SECRET_BASE64;
    delete process.env.ATO_PRN;
  });
});

test("issueRPT fails fast when the signing secret is missing", async () => {
  const issuerModule = await issuerModulePromise;
  const { issueRPT, __testHooks, __resetIssuerSecretForTest } = issuerModule;

  __testHooks.reset();
  __resetIssuerSecretForTest();

  let poolConstructed = 0;
  __testHooks.setPoolFactory(() => {
    poolConstructed += 1;
    return {
      async query() {
        throw new Error("query should not be called when secret is missing");
      }
    } as any;
  });
  __testHooks.setSignFn((payload, key) => "should not sign");
  __testHooks.setExceedsFn(() => false);

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  delete process.env.RPT_ED25519_SECRET_BASE64;

  await assert.rejects(
    () => issueRPT("123", "GST", "2024Q4", {}),
    /RPT_ED25519_SECRET_BASE64/,
    "should surface a configuration error"
  );

  assert.equal(poolConstructed, 0, "database pool should not be constructed when secret is missing");

  process.env.NODE_ENV = previousNodeEnv;
  __testHooks.reset();
});
