import { Request, Response } from "express";
import { readFile } from "fs/promises";
import path from "path";
import { Pool } from "pg";

import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle, loadLedger, loadRptToken, RULES_DIR } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { createZip } from "../utils/zip";

const pool = new Pool();

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body ?? {};
  const thr =
    thresholds ||
    { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? "ISSUE_FAILED" });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body ?? {};
  try {
    const pr = await pool.query(
      `select payload from rpt_tokens where abn = $1 and tax_type = $2 and period_id = $3 order by id desc limit 1`,
      [abn, taxType, periodId],
    );
    if (pr.rowCount === 0) {
      return res.status(400).json({ error: "NO_RPT" });
    }
    const payload = pr.rows[0].payload;
    await resolveDestination(abn, rail, payload.reference);
    const release = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query(`update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3`, [abn, taxType, periodId]);
    return res.json(release);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? "PAYMENT_FAILED" });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body ?? {};
  const result = await paytoDebit(abn, amount_cents, reference);
  return res.json(result);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as { abn?: string; taxType?: string; periodId?: string };
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }
  try {
    const bundle = await buildEvidenceBundle(abn, taxType, periodId);
    return res.json(bundle);
  } catch (error: any) {
    if (error?.message === "PERIOD_NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    if (error?.message === "MISSING_PARAMS") {
      return res.status(400).json({ error: "MISSING_PARAMS" });
    }
    console.error("Failed to build evidence bundle", error);
    return res.status(500).json({ error: "FAILED_TO_BUILD_EVIDENCE" });
  }
}

function toCsvValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function evidenceZip(req: Request, res: Response) {
  const { periodId } = req.params;
  const { abn, taxType } = req.query as { abn?: string; taxType?: string };
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }

  try {
    const bundle = await buildEvidenceBundle(abn, taxType, periodId);
    const entries: { name: string; data: Buffer }[] = [];
    entries.push({ name: "evidence.json", data: Buffer.from(JSON.stringify(bundle, null, 2), "utf8") });

    const rpt = await loadRptToken(abn, taxType, periodId);
    if (rpt?.payload) {
      entries.push({
        name: "attachments/rpt_payload.json",
        data: Buffer.from(JSON.stringify(rpt.payload, null, 2), "utf8"),
      });
    }
    if (rpt?.signature) {
      entries.push({ name: "attachments/rpt_signature.txt", data: Buffer.from(rpt.signature, "utf8") });
    }

    entries.push({ name: "attachments/manifest.json", data: Buffer.from(JSON.stringify(bundle.rules, null, 2), "utf8") });

    const ledger = await loadLedger(abn, taxType, periodId);
    if (ledger.length > 0) {
      const rows = ledger.map((entry) =>
        [
          entry.id,
          entry.amount_cents,
          entry.balance_after_cents,
          entry.bank_receipt_hash ?? "",
          entry.prev_hash ?? "",
          entry.hash_after ?? "",
          entry.created_at ? entry.created_at.toISOString() : "",
        ]
          .map(toCsvValue)
          .join(","),
      );
      entries.push({
        name: "attachments/owa_ledger.csv",
        data: Buffer.from([
          "id,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after,created_at",
          ...rows,
        ].join("\n") + "\n", "utf8"),
      });
    }

    const rulesRoot = path.resolve(RULES_DIR);
    for (const file of bundle.rules.files) {
      try {
        const resolved = path.resolve(RULES_DIR, file.name);
        if (path.relative(rulesRoot, resolved).startsWith("..")) {
          continue;
        }
        const data = await readFile(resolved);
        entries.push({ name: `attachments/rules/${file.name}`, data });
      } catch (error) {
        console.warn(`Unable to attach rule file ${file.name}:`, error);
      }
    }

    const zipBuffer = createZip(entries);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="evidence-${abn}-${periodId}.zip"`);
    return res.send(zipBuffer);
  } catch (error: any) {
    if (error?.message === "PERIOD_NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    if (error?.message === "MISSING_PARAMS") {
      return res.status(400).json({ error: "MISSING_PARAMS" });
    }
    console.error("Failed to build evidence zip", error);
    return res.status(500).json({ error: "FAILED_TO_BUILD_EVIDENCE_ZIP" });
  }
}
