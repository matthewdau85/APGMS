import { Pool } from "pg";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const pool = new Pool();

type Attachment = {
  name: string;
  description: string;
  mime: string;
  data: Buffer;
};

type AttachmentMeta = Omit<Attachment, "data"> & { size: number };

type RuleFile = {
  name: string;
  sha256: string;
  size: number;
};

type EvidenceBundle = {
  meta: {
    generated_at: string;
    abn: string;
    taxType: string;
    periodId: string;
  };
  period: any;
  rpt: null | {
    payload: any;
    signature: string | null;
    created_at: string | null;
    payload_sha256: string | null;
  };
  hashes: {
    merkle_root: string | null;
    running_balance_hash: string | null;
    ledger_head_hash: string | null;
    bank_receipt_hash: string | null;
    rpt_payload_sha256: string | null;
  };
  owa_ledger: Array<{
    id: number;
    transfer_uuid: string;
    amount_cents: number;
    balance_after_cents: number;
    bank_receipt_hash: string | null;
    prev_hash: string | null;
    hash_after: string | null;
    created_at: string;
  }>;
  rules: {
    rates_version: string;
    files: RuleFile[];
  };
  approvals: Array<{ actor: string; action: string; at: string; payload_hash?: string | null }>;
  settlement: {
    receipt: string | null;
    ledger_entries: number;
    balance_after_cents: number | null;
  };
  discrepancy_log: any[];
  attachments: AttachmentMeta[];
};

type EvidenceArtifacts = {
  bundle: EvidenceBundle;
  attachments: Attachment[];
};

let cachedRuleFiles: { version: string; files: RuleFile[] } | null = null;

function sha256Hex(input: string | Buffer) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function loadRuleHashes(): Promise<{ version: string; files: RuleFile[] }> {
  if (cachedRuleFiles) return cachedRuleFiles;
  const rulesDir = path.join(process.cwd(), "libs", "schemas", "json");
  let files: RuleFile[] = [];
  try {
    const entries = await fs.readdir(rulesDir);
    files = await Promise.all(
      entries.sort().map(async (name) => {
        const full = path.join(rulesDir, name);
        const stat = await fs.stat(full);
        if (!stat.isFile()) {
          return null;
        }
        const data = await fs.readFile(full);
        return {
          name,
          sha256: sha256Hex(data),
          size: stat.size,
        } as RuleFile;
      })
    );
    files = files.filter((f): f is RuleFile => Boolean(f));
  } catch {
    files = [];
  }
  const version = files.length ? `rules-${files.length}-files` : "rules-unavailable";
  cachedRuleFiles = { version, files };
  return cachedRuleFiles;
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string): Promise<EvidenceArtifacts> {
  const periodQ = await pool.query(
    "SELECT state, accrued_cents, credited_to_owa_cents, final_liability_cents, merkle_root, running_balance_hash, anomaly_vector, thresholds FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [abn, taxType, periodId]
  );
  const periodRow = periodQ.rows[0] ?? null;

  const rptQ = await pool.query(
    "SELECT payload, signature, created_at FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY created_at DESC LIMIT 1",
    [abn, taxType, periodId]
  );
  const rptRow = rptQ.rows[0] ?? null;

  const ledgerQ = await pool.query(
    "SELECT id, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id",
    [abn, taxType, periodId]
  );
  const ledgerRows = ledgerQ.rows.map((row) => ({
    id: Number(row.id),
    transfer_uuid: row.transfer_uuid,
    amount_cents: Number(row.amount_cents),
    balance_after_cents: Number(row.balance_after_cents),
    bank_receipt_hash: row.bank_receipt_hash ?? null,
    prev_hash: row.prev_hash ?? null,
    hash_after: row.hash_after ?? null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));

  const lastLedger = ledgerRows.length ? ledgerRows[ledgerRows.length - 1] : null;

  const { version: ratesVersion, files: ruleFiles } = await loadRuleHashes();

  const rptPayload = rptRow?.payload ?? null;
  const rptSignature = rptRow?.signature ?? null;
  const rptCreated = rptRow?.created_at instanceof Date ? rptRow.created_at.toISOString() : rptRow?.created_at ?? null;
  const rptPayloadSha = rptPayload ? sha256Hex(JSON.stringify(rptPayload)) : null;

  const approvalsQ = await pool.query(
    `SELECT seq, ts, actor, action, payload_hash FROM audit_log
     WHERE action ILIKE $1 OR ($2 IS NOT NULL AND payload_hash = $2) OR ($3 IS NOT NULL AND payload_hash = $3)
     ORDER BY ts`,
    [`%${periodId}%`, periodRow?.merkle_root ?? null, periodRow?.running_balance_hash ?? null]
  );
  const approvals = approvalsQ.rows
    .map((row: any) => ({
      actor: row.actor ?? "system",
      action: row.action ?? "",
      at: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts ?? ""),
      payload_hash: row.payload_hash ?? null,
    }))
    .filter((row) => row.action?.toString().trim().length);

  if (!approvals.length && rptCreated) {
    approvals.push({ actor: "system", action: "RPT_ISSUED", at: rptCreated, payload_hash: null });
  }

  const attachments: Attachment[] = [];

  if (rptPayload) {
    const payloadBuf = Buffer.from(JSON.stringify(rptPayload, null, 2), "utf8");
    attachments.push({
      name: "rpt/payload.json",
      description: "RPT payload (canonical JSON)",
      mime: "application/json",
      data: payloadBuf,
    });
  }
  if (rptSignature) {
    attachments.push({
      name: "rpt/signature.txt",
      description: "RPT ed25519 signature",
      mime: "text/plain",
      data: Buffer.from(String(rptSignature), "utf8"),
    });
  }
  if (ledgerRows.length) {
    const csv = [
      "id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after,created_at",
      ...ledgerRows.map((row) =>
        [
          row.id,
          row.transfer_uuid,
          row.amount_cents,
          row.balance_after_cents,
          row.bank_receipt_hash ?? "",
          row.prev_hash ?? "",
          row.hash_after ?? "",
          row.created_at,
        ].join(",")
      ),
    ].join("\n");
    attachments.push({
      name: "ledger/owa_ledger.csv",
      description: "OWA ledger entries for the period",
      mime: "text/csv",
      data: Buffer.from(csv, "utf8"),
    });
  }
  if (approvals.length) {
    attachments.push({
      name: "approvals.json",
      description: "Approval and audit log excerpts",
      mime: "application/json",
      data: Buffer.from(JSON.stringify(approvals, null, 2), "utf8"),
    });
  }

  const attachmentsMeta: AttachmentMeta[] = attachments.map(({ name, description, mime, data }) => ({
    name,
    description,
    mime,
    size: data.length,
  }));

  const bundle: EvidenceBundle = {
    meta: {
      generated_at: new Date().toISOString(),
      abn,
      taxType,
      periodId,
    },
    period: periodRow
      ? {
          state: periodRow.state,
          accrued_cents: Number(periodRow.accrued_cents ?? 0),
          credited_to_owa_cents: Number(periodRow.credited_to_owa_cents ?? 0),
          final_liability_cents: Number(periodRow.final_liability_cents ?? 0),
          merkle_root: periodRow.merkle_root ?? null,
          running_balance_hash: periodRow.running_balance_hash ?? null,
          anomaly_vector: periodRow.anomaly_vector ?? {},
          thresholds: periodRow.thresholds ?? {},
        }
      : null,
    rpt: rptRow
      ? {
          payload: rptPayload,
          signature: rptSignature,
          created_at: rptCreated,
          payload_sha256: rptPayloadSha,
        }
      : null,
    hashes: {
      merkle_root: periodRow?.merkle_root ?? null,
      running_balance_hash: periodRow?.running_balance_hash ?? null,
      ledger_head_hash: lastLedger?.hash_after ?? null,
      bank_receipt_hash: lastLedger?.bank_receipt_hash ?? null,
      rpt_payload_sha256: rptPayloadSha,
    },
    owa_ledger: ledgerRows,
    rules: {
      rates_version: ratesVersion,
      files: ruleFiles,
    },
    approvals,
    settlement: {
      receipt: lastLedger?.bank_receipt_hash ?? null,
      ledger_entries: ledgerRows.length,
      balance_after_cents: lastLedger ? Number(lastLedger.balance_after_cents) : null,
    },
    discrepancy_log: [],
    attachments: attachmentsMeta,
  };

  return { bundle, attachments };
}
