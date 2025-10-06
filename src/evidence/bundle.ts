import { Pool } from "pg";

const pool = new Pool();

type JsonRecord = Record<string, unknown>;

type ZipEntry = {
  name: string;
  data: Buffer;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      if ((c & 1) !== 0) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c >>>= 1;
      }
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const getDosDateTime = (date: Date) => {
  const year = Math.max(date.getUTCFullYear(), 1980);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
};

const createZip = (entries: ZipEntry[]): Buffer => {
  if (!entries.length) {
    return Buffer.alloc(0);
  }

  const fileParts: Buffer[] = [];
  const centralDirectoryParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const dataBuffer = entry.data;
    const { dosDate, dosTime } = getDosDateTime(new Date());
    const crc = crc32(dataBuffer);
    const size = dataBuffer.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    fileParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralDirectoryParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + size;
  }

  const centralDirectory = Buffer.concat(centralDirectoryParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...fileParts, centralDirectory, endRecord]);
};

const normalizeSettlement = (raw: unknown): JsonRecord | null => {
  if (!isRecord(raw)) return null;
  const settlement: JsonRecord = { ...raw };
  const providerRef =
    typeof raw["provider_ref"] === "string"
      ? (raw["provider_ref"] as string)
      : typeof raw["providerRef"] === "string"
        ? (raw["providerRef"] as string)
        : typeof raw["reference"] === "string"
          ? (raw["reference"] as string)
          : null;
  const rail =
    typeof raw["rail"] === "string"
      ? (raw["rail"] as string)
      : typeof raw["channel"] === "string"
        ? (raw["channel"] as string)
        : null;
  const paidAt =
    typeof raw["paid_at"] === "string"
      ? (raw["paid_at"] as string)
      : typeof raw["paidAt"] === "string"
        ? (raw["paidAt"] as string)
        : null;
  const receiptUrl =
    typeof raw["receipt_url"] === "string"
      ? (raw["receipt_url"] as string)
      : typeof raw["receiptUrl"] === "string"
        ? (raw["receiptUrl"] as string)
        : typeof raw["receipt_link"] === "string"
          ? (raw["receipt_link"] as string)
          : typeof raw["receipt"] === "string"
            ? (raw["receipt"] as string)
            : null;

  settlement["provider_ref"] = providerRef;
  settlement["rail"] = rail;
  settlement["paid_at"] = paidAt;
  if (receiptUrl) settlement["receipt_url"] = receiptUrl;

  return settlement;
};

const normalizeApprovals = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  return [];
};

const buildRules = (
  manifest: unknown,
  settlement: JsonRecord | null,
  thresholds: JsonRecord
): { manifest_sha256: string | null; rates_version: string | null } => {
  const manifestSha = typeof manifest === "string" ? manifest : null;
  let ratesVersion: string | null = null;
  if (settlement && typeof settlement["rates_version"] === "string") {
    ratesVersion = settlement["rates_version"] as string;
  } else if (typeof thresholds["rates_version"] === "string") {
    ratesVersion = thresholds["rates_version"] as string;
  } else if (typeof process.env.RULES_RATES_VERSION === "string") {
    ratesVersion = process.env.RULES_RATES_VERSION;
  }
  return { manifest_sha256: manifestSha, rates_version: ratesVersion };
};

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const periodResult = await pool.query(
    "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [abn, taxType, periodId]
  );
  if (!periodResult.rowCount) {
    const err: NodeJS.ErrnoException = new Error("NOT_FOUND");
    err.code = "NOT_FOUND";
    (err as { statusCode?: number }).statusCode = 404;
    throw err;
  }

  const period = periodResult.rows[0];
  const thresholds = isRecord(period.thresholds) ? (period.thresholds as JsonRecord) : {};
  const anomalyVector = isRecord(period.anomaly_vector) ? period.anomaly_vector : {};

  const rptResult = await pool.query(
    `SELECT payload, payload_c14n, payload_sha256, signature, created_at
       FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY created_at DESC
      LIMIT 1`,
    [abn, taxType, periodId]
  );
  const rpt = rptResult.rows[0] ?? null;

  const ledgerResult = await pool.query(
    `SELECT id, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id`,
    [abn, taxType, periodId]
  );
  const ledgerRows = ledgerResult.rows.map((row) => ({
    ...row,
    amount_cents: toNumber(row.amount_cents),
    balance_after_cents:
      row.balance_after_cents === null || row.balance_after_cents === undefined
        ? null
        : toNumber(row.balance_after_cents),
  }));

  const bundleMetaResult = await pool.query(
    `SELECT rules_manifest_sha256, settlement, approvals, narrative, simulated
       FROM evidence_bundles
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id DESC
      LIMIT 1`,
    [abn, taxType, periodId]
  );
  const bundleMeta = bundleMetaResult.rows[0] ?? {};

  const settlement = normalizeSettlement((bundleMeta as { settlement?: unknown }).settlement);
  const approvals = normalizeApprovals((bundleMeta as { approvals?: unknown }).approvals);
  const narrativeValue = (bundleMeta as { narrative?: unknown }).narrative;
  const narrative = typeof narrativeValue === "string" ? narrativeValue : "";
  const simulated = Boolean((bundleMeta as { simulated?: unknown }).simulated);
  const rules = buildRules(
    (bundleMeta as { rules_manifest_sha256?: unknown }).rules_manifest_sha256,
    settlement,
    thresholds
  );

  const lastLedger = ledgerRows.length ? ledgerRows[ledgerRows.length - 1] : null;

  const bundle = {
    meta: { generated_at: new Date().toISOString(), abn, taxType, periodId },
    period: {
      state: period.state,
      accrued_cents: toNumber(period.accrued_cents),
      credited_to_owa_cents: toNumber(period.credited_to_owa_cents),
      final_liability_cents: toNumber(period.final_liability_cents),
      merkle_root: period.merkle_root ?? null,
      running_balance_hash: period.running_balance_hash ?? null,
      anomaly_vector,
      thresholds,
    },
    rpt,
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger: ledgerRows,
    owa_ledger_deltas: ledgerRows,
    bank_receipt_hash: lastLedger?.bank_receipt_hash ?? null,
    anomaly_thresholds: thresholds,
    discrepancy_log: [],
    simulated,
    rules,
    settlement,
    approvals,
    narrative,
  };

  return bundle;
}

export async function buildEvidenceZip(abn: string, taxType: string, periodId: string) {
  const bundle = await buildEvidenceBundle(abn, taxType, periodId);
  const entries: ZipEntry[] = [
    { name: "evidence.json", data: Buffer.from(JSON.stringify(bundle, null, 2), "utf8") },
  ];

  const settlement = bundle.settlement as JsonRecord | null;
  const receiptsRaw = settlement && Array.isArray(settlement["receipts"])
    ? (settlement["receipts"] as unknown[])
    : [];

  let addedReceipt = false;
  receiptsRaw.forEach((receipt, idx) => {
    if (typeof receipt === "string") {
      entries.push({
        name: `receipts/receipt-${idx + 1}.txt`,
        data: Buffer.from(receipt, "utf8"),
      });
      addedReceipt = true;
    } else if (isRecord(receipt)) {
      const name =
        typeof receipt["filename"] === "string"
          ? (receipt["filename"] as string)
          : typeof receipt["name"] === "string"
            ? (receipt["name"] as string)
            : `receipt-${idx + 1}.txt`;
      if (typeof receipt["content"] === "string") {
        entries.push({ name: `receipts/${name}`, data: Buffer.from(receipt["content"] as string, "utf8") });
        addedReceipt = true;
      } else if (typeof receipt["base64"] === "string") {
        entries.push({ name: `receipts/${name}`, data: Buffer.from(receipt["base64"] as string, "base64") });
        addedReceipt = true;
      }
    }
  });

  if (!addedReceipt) {
    const providerRef = settlement && typeof settlement["provider_ref"] === "string"
      ? (settlement["provider_ref"] as string)
      : null;
    const receiptUrl = settlement && typeof settlement["receipt_url"] === "string"
      ? (settlement["receipt_url"] as string)
      : null;
    let message = "No receipt artifacts were recorded for this evidence bundle.";
    if (bundle.simulated) {
      message = "Simulated settlement run – no real-world receipt was generated.";
      if (providerRef) {
        message += `\nProvider reference: ${providerRef}`;
      }
    } else if (receiptUrl) {
      message = `Receipt available at: ${receiptUrl}`;
    }
    entries.push({ name: "receipts/receipt.txt", data: Buffer.from(message, "utf8") });
  }

  return createZip(entries);
}
