import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ProviderRegistry,
  ProviderConfig,
  ProviderFactoryRegistry,
  ProviderKillSwitchError,
  ProviderKey,
} from "@core/providerRegistry";
import { BankDestination } from "@core/ports";
import { createMockBankProvider } from "@core/providers/bank/mockBankProvider";
import { createPostgresBankProvider } from "@core/providers/bank/postgresBankProvider";
import { createMockKmsProvider } from "@core/providers/kms/mockKmsProvider";
import { createEnvKmsProvider } from "@core/providers/kms/envKmsProvider";
import { createMockRatesProvider } from "@core/providers/rates/mockRatesProvider";
import { createStaticRatesProvider } from "@core/providers/rates/staticRatesProvider";
import { createMockIdentityProvider } from "@core/providers/identity/mockIdentityProvider";
import { createDevIdentityProvider } from "@core/providers/identity/devIdentityProvider";
import { createMockAnomalyProvider } from "@core/providers/anomaly/mockAnomalyProvider";
import { createDeterministicAnomalyProvider } from "@core/providers/anomaly/deterministicAnomalyProvider";
import { createMockStatementsProvider } from "@core/providers/statements/mockStatementsProvider";
import { createLocalStatementsProvider } from "@core/providers/statements/localStatementsProvider";

class FakePool {
  private destinations = new Map<string, BankDestination>();
  private idempotency = new Map<string, string>();
  private ledger: Array<{ balance_after_cents: number; hash_after: string }> = [];

  constructor(destinations: BankDestination[]) {
    for (const dest of destinations) {
      this.destinations.set(`${dest.abn}:${dest.rail}:${dest.reference}`, dest);
    }
  }

  async query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (text.includes("from remittance_destinations")) {
      const [abn, rail, reference] = params;
      const dest = this.destinations.get(`${abn}:${rail}:${reference}`);
      if (!dest) return { rows: [], rowCount: 0 };
      return { rows: [dest] as T[], rowCount: 1 };
    }
    if (text.startsWith("insert into idempotency_keys")) {
      const [key, status] = params;
      if (this.idempotency.has(key)) {
        throw new Error("duplicate key value violates unique constraint");
      }
      this.idempotency.set(key, status);
      return { rows: [] as T[], rowCount: 1 };
    }
    if (text.includes("from owa_ledger")) {
      const last = this.ledger[this.ledger.length - 1];
      if (!last) return { rows: [] as T[], rowCount: 0 };
      return { rows: [last as T], rowCount: 1 };
    }
    if (text.startsWith("insert into owa_ledger")) {
      const row = { balance_after_cents: params[5], hash_after: params[8] };
      this.ledger.push(row);
      return { rows: [] as T[], rowCount: 1 };
    }
    if (text.startsWith("update idempotency_keys")) {
      const [status, key] = params;
      this.idempotency.set(key, status);
      return { rows: [] as T[], rowCount: 1 };
    }
    throw new Error(`Unsupported query in FakePool: ${text}`);
  }
}

const DESTINATION: BankDestination = {
  abn: "12345678901",
  rail: "EFT",
  reference: "PRN123",
  account_name: "ATO PAYMENTS",
  account_number: "12345678",
  bsb: "123-456",
};

function buildRegistry(
  primary: Partial<Record<ProviderKey, string>>,
  overrides?: Partial<ProviderFactoryRegistry>,
  shadow: Partial<Record<ProviderKey, string>> = {},
  killed: ProviderKey[] = []
) {
  const config: ProviderConfig = { primary, shadow, killed: new Set(killed) };
  return new ProviderRegistry(config, overrides);
}

describe("Bank provider contract", () => {
  const fakePool = new FakePool([DESTINATION]);
  const overrides: Partial<ProviderFactoryRegistry> = {
    bank: {
      mock: () => createMockBankProvider({ destinations: [DESTINATION] }),
      postgres: () =>
        createPostgresBankProvider({ pool: fakePool, auditLogger: async () => undefined, uuidFactory: () => "uuid-test" }),
    },
    kms: { mock: () => createMockKmsProvider() },
    rates: { mock: () => createMockRatesProvider() },
    identity: { mock: () => createMockIdentityProvider() },
    anomaly: { mock: () => createMockAnomalyProvider() },
    statements: { mock: () => createMockStatementsProvider() },
  };

  for (const name of ["mock", "postgres"] as const) {
    it(`releases payments using ${name}`, async () => {
      const registry = buildRegistry(
        { bank: name, kms: "mock", rates: "mock", identity: "mock", anomaly: "mock", statements: "mock" },
        overrides
      );
      const bank = registry.get("bank");
      const dest = await bank.resolveDestination(DESTINATION.abn, DESTINATION.rail, DESTINATION.reference);
      assert.equal(dest.account_number, DESTINATION.account_number);

      const release = await bank.releasePayment(DESTINATION.abn, "GST", "2025Q1", 1000, DESTINATION.rail, DESTINATION.reference);
      assert.equal(release.status, "OK");
      assert.ok(release.transfer_uuid);
      assert.ok(release.bank_receipt_hash.startsWith("bank:"));

      await assert.rejects(() => bank.releasePayment(DESTINATION.abn, "GST", "2025Q1", -1, DESTINATION.rail, DESTINATION.reference));
    });
  }
});

describe("KMS provider contract", () => {
  const payload = new TextEncoder().encode("hello");
  const secret = Buffer.alloc(64, 7);
  process.env.RPT_ED25519_SECRET_BASE64 = secret.toString("base64");

  const overrides: Partial<ProviderFactoryRegistry> = {
    kms: {
      mock: () => createMockKmsProvider({ privateKey: secret }),
      env: () => createEnvKmsProvider(),
    },
  };

  for (const name of ["mock", "env"] as const) {
    it(`signs payloads with ${name}`, async () => {
      const registry = buildRegistry(
        {
          bank: "mock",
          kms: name,
          rates: "mock",
          identity: "mock",
          anomaly: "mock",
          statements: "mock",
        },
        {
          ...overrides,
          bank: { mock: () => createMockBankProvider({ destinations: [DESTINATION] }) },
          rates: { mock: () => createMockRatesProvider() },
          identity: { mock: () => createMockIdentityProvider() },
          anomaly: { mock: () => createMockAnomalyProvider() },
          statements: { mock: () => createMockStatementsProvider() },
        }
      );
      const kms = registry.get("kms");
      const { signature } = await kms.signEd25519("RPT_ED25519_SECRET", payload);
      assert.ok(signature.byteLength > 0);
    });
  }
});

describe("Rates provider contract", () => {
  const overrides: Partial<ProviderFactoryRegistry> = {
    rates: {
      mock: () => createMockRatesProvider(),
      static: () => createStaticRatesProvider(),
    },
  };
  for (const name of ["mock", "static"] as const) {
    it(`returns rates for ${name}`, async () => {
      const registry = buildRegistry(
        { bank: "mock", kms: "mock", rates: name, identity: "mock", anomaly: "mock", statements: "mock" },
        {
          ...overrides,
          bank: { mock: () => createMockBankProvider({ destinations: [DESTINATION] }) },
          kms: { mock: () => createMockKmsProvider() },
          identity: { mock: () => createMockIdentityProvider() },
          anomaly: { mock: () => createMockAnomalyProvider() },
          statements: { mock: () => createMockStatementsProvider() },
        }
      );
      const rates = registry.get("rates");
      const quote = await rates.getRate("AUD/USD");
      assert.equal(quote.pair, "AUD/USD");
      assert.ok(quote.rate > 0);
    });
  }
});

describe("Identity provider contract", () => {
  const overrides: Partial<ProviderFactoryRegistry> = {
    identity: {
      mock: () => createMockIdentityProvider(),
      dev: () => createDevIdentityProvider(),
    },
  };
  it("authenticates tokens across providers", async () => {
    const registry = buildRegistry(
      { bank: "mock", kms: "mock", rates: "mock", identity: "mock", anomaly: "mock", statements: "mock" },
      {
        ...overrides,
        bank: { mock: () => createMockBankProvider({ destinations: [DESTINATION] }) },
        kms: { mock: () => createMockKmsProvider() },
        rates: { mock: () => createMockRatesProvider() },
        anomaly: { mock: () => createMockAnomalyProvider() },
        statements: { mock: () => createMockStatementsProvider() },
      }
    );
    const mockProvider = registry.get("identity");
    const profile = await mockProvider.verifyToken("token:admin");
    assert.equal(profile.id, "token:admin");

    const devRegistry = buildRegistry(
      { bank: "mock", kms: "mock", rates: "mock", identity: "dev", anomaly: "mock", statements: "mock" },
      {
        ...overrides,
        bank: { mock: () => createMockBankProvider({ destinations: [DESTINATION] }) },
        kms: { mock: () => createMockKmsProvider() },
        rates: { mock: () => createMockRatesProvider() },
        anomaly: { mock: () => createMockAnomalyProvider() },
        statements: { mock: () => createMockStatementsProvider() },
      }
    );
    const devProvider = devRegistry.get("identity");
    const admin = await devProvider.verifyToken("token:admin");
    assert.equal(admin.id, "admin");
    await assert.rejects(() => devProvider.verifyToken("token:unknown"));
  });
});

describe("Anomaly provider contract", () => {
  const overrides: Partial<ProviderFactoryRegistry> = {
    anomaly: {
      mock: () => createMockAnomalyProvider(),
      deterministic: () => createDeterministicAnomalyProvider(),
    },
  };

  it("evaluates anomaly vectors", async () => {
    const registry = buildRegistry(
      { bank: "mock", kms: "mock", rates: "mock", identity: "mock", anomaly: "mock", statements: "mock" },
      {
        ...overrides,
        bank: { mock: () => createMockBankProvider({ destinations: [DESTINATION] }) },
        kms: { mock: () => createMockKmsProvider() },
        rates: { mock: () => createMockRatesProvider() },
        identity: { mock: () => createMockIdentityProvider() },
        statements: { mock: () => createMockStatementsProvider() },
      }
    );
    const mockProvider = registry.get("anomaly");
    const result = await mockProvider.evaluate({ variance_ratio: 0.1 });
    assert.equal(result.anomalous, false);

    const deterministicRegistry = buildRegistry(
      { bank: "mock", kms: "mock", rates: "mock", identity: "mock", anomaly: "deterministic", statements: "mock" },
      {
        ...overrides,
        bank: { mock: () => createMockBankProvider({ destinations: [DESTINATION] }) },
        kms: { mock: () => createMockKmsProvider() },
        rates: { mock: () => createMockRatesProvider() },
        identity: { mock: () => createMockIdentityProvider() },
        statements: { mock: () => createMockStatementsProvider() },
      }
    );
    const deterministic = deterministicRegistry.get("anomaly");
    const flagged = await deterministic.evaluate({ variance_ratio: 0.5 });
    assert.equal(flagged.anomalous, true);
    assert.ok(flagged.triggers.includes("variance_ratio"));
  });
});

describe("Statements provider contract", () => {
  const overrides: Partial<ProviderFactoryRegistry> = {
    statements: {
      mock: () => createMockStatementsProvider(),
      local: () => createLocalStatementsProvider({ directory: "samples/statements" }),
    },
  };

  for (const name of ["mock", "local"] as const) {
    it(`fetches statements from ${name}`, async () => {
      const registry = buildRegistry(
        { bank: "mock", kms: "mock", rates: "mock", identity: "mock", anomaly: "mock", statements: name },
        {
          ...overrides,
          bank: { mock: () => createMockBankProvider({ destinations: [DESTINATION] }) },
          kms: { mock: () => createMockKmsProvider() },
          rates: { mock: () => createMockRatesProvider() },
          identity: { mock: () => createMockIdentityProvider() },
          anomaly: { mock: () => createMockAnomalyProvider() },
        }
      );
      const statements = registry.get("statements");
      const lines = await statements.fetchStatements("12345678901", "2025Q1");
      assert.ok(Array.isArray(lines));
    });
  }
});

describe("Kill switch and shadow behaviour", () => {
  it("blocks killed providers", () => {
    const registry = buildRegistry(
      { bank: "mock", kms: "mock", rates: "mock", identity: "mock", anomaly: "mock", statements: "mock" },
      {
        bank: { mock: () => createMockBankProvider({ destinations: [DESTINATION] }) },
        kms: { mock: () => createMockKmsProvider() },
        rates: { mock: () => createMockRatesProvider() },
        identity: { mock: () => createMockIdentityProvider() },
        anomaly: { mock: () => createMockAnomalyProvider() },
        statements: { mock: () => createMockStatementsProvider() },
      },
      {},
      ["bank"]
    );
    assert.throws(() => registry.get("bank"), ProviderKillSwitchError);
  });

  it("invokes shadow providers", async () => {
    let shadowCalls = 0;
    const registry = buildRegistry(
      { bank: "mock", kms: "mock", rates: "mock", identity: "mock", anomaly: "mock", statements: "mock" },
      {
        bank: {
          mock: () => createMockBankProvider({ destinations: [DESTINATION] }),
          shadow: () => ({
            async resolveDestination() {
              shadowCalls += 1;
              return DESTINATION;
            },
            async releasePayment() {
              shadowCalls += 1;
              return { transfer_uuid: "shadow", bank_receipt_hash: "shadow", status: "OK" };
            },
          }),
        },
        kms: { mock: () => createMockKmsProvider() },
        rates: { mock: () => createMockRatesProvider() },
        identity: { mock: () => createMockIdentityProvider() },
        anomaly: { mock: () => createMockAnomalyProvider() },
        statements: { mock: () => createMockStatementsProvider() },
      },
      { bank: "shadow" }
    );
    const bank = registry.get("bank");
    await bank.resolveDestination(DESTINATION.abn, DESTINATION.rail, DESTINATION.reference);
    await bank.releasePayment(DESTINATION.abn, "GST", "2025Q1", 1000, DESTINATION.rail, DESTINATION.reference);
    assert.ok(shadowCalls >= 2);
  });
});
