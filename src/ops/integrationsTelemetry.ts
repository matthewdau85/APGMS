import type { RequestHandler } from "express";
import { Pool } from "pg";

const pool = new Pool();

const toIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

type ReceiptRow = {
  last_receipt_at: string | null;
  abn: string | null;
  tax_type: string | null;
  period_id: string | null;
};

type ReconRow = {
  last_recon_import_at: string | null;
  id: number | null;
};

export const integrationsTelemetry: RequestHandler = async (_req, res) => {
  try {
    const [receiptResult, reconResult] = await Promise.all([
      pool.query<ReceiptRow>(
        `with latest as (
           select max(paid_at) as paid_at
           from settlements
         )
         select
           latest.paid_at as last_receipt_at,
           s.abn,
           s.tax_type,
           s.period_id
         from latest
         left join settlements s on s.paid_at = latest.paid_at
         order by s.paid_at desc nulls last
         limit 1`
      ),
      pool.query<ReconRow>(
        `with latest as (
           select max(imported_at) as imported_at
           from recon_imports
         )
         select
           latest.imported_at as last_recon_import_at,
           r.id
         from latest
         left join recon_imports r on r.imported_at = latest.imported_at
         order by r.imported_at desc nulls last, r.id desc nulls last
         limit 1`
      ),
    ]);

    const receiptRow = receiptResult.rows[0] || {
      last_receipt_at: null,
      abn: null,
      tax_type: null,
      period_id: null,
    };

    const reconRow = reconResult.rows[0] || {
      last_recon_import_at: null,
      id: null,
    };

    const evidenceLink =
      receiptRow.abn && receiptRow.tax_type && receiptRow.period_id
        ? `/api/evidence?abn=${encodeURIComponent(receiptRow.abn)}&taxType=${encodeURIComponent(receiptRow.tax_type)}&periodId=${encodeURIComponent(receiptRow.period_id)}`
        : null;

    const reconLogLink =
      typeof reconRow.id === "number"
        ? `/ops/recon/imports/${encodeURIComponent(String(reconRow.id))}`
        : null;

    res.json({
      last_receipt_at: toIso(receiptRow.last_receipt_at),
      last_recon_import_at: toIso(reconRow.last_recon_import_at),
      links: {
        evidence: evidenceLink,
        recon_import_log: reconLogLink,
      },
    });
  } catch (error) {
    console.error("[ops] failed to load integration telemetry", error);
    res.status(500).json({ error: "TELEMETRY_UNAVAILABLE" });
  }
};
