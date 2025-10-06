import { buildEvidenceBundle } from "../../src/evidence/bundle";
import { RULES_MANIFEST_SHA256, RATES_VERSION } from "../../src/rules/manifest";

type QueryResult = { rows: any[]; rowCount: number };

type QueryArgs = [string, any[]?];

class StubPool {
  private calls: QueryArgs[] = [];

  async query(text: string, params?: any[]): Promise<QueryResult> {
    this.calls.push([text, params]);
    if (text.includes("from periods")) {
      return { rows: [{ thresholds: { epsilon_cents: 0 } }], rowCount: 1 };
    }
    if (text.includes("from rpt_tokens")) {
      return {
        rows: [{ payload: { amount_cents: 1234, reference: "REF", rates_version: RATES_VERSION, rules_manifest_sha256: RULES_MANIFEST_SHA256 } }],
        rowCount: 1,
      };
    }
    if (text.includes("from owa_ledger")) {
      return {
        rows: [
          { ts: new Date().toISOString(), amount_cents: 1234, hash_after: "h", bank_receipt_hash: "bank" },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }
}

async function main() {
  const stub = new StubPool();
  const bundle = await buildEvidenceBundle("123", "GST", "2024-09", { pool: stub as any });
  if (!bundle.rules) {
    throw new Error("rules missing from bundle");
  }
  if (bundle.rules.version !== RATES_VERSION) {
    throw new Error(`expected rates version ${RATES_VERSION} got ${bundle.rules.version}`);
  }
  if (bundle.rules.manifest_sha256 !== RULES_MANIFEST_SHA256) {
    throw new Error("manifest hash mismatch");
  }
  if (!Array.isArray(bundle.rules.files) || bundle.rules.files.length === 0) {
    throw new Error("manifest files missing");
  }
  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
