import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const pool = new Pool();
const execFileAsync = promisify(execFile);

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body;
  const pr = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: any, res: any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: any, res: any) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_QUERY" });
  }
  try {
    const { bundle } = await buildEvidenceBundle(abn, taxType, periodId);
    return res.json(bundle);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function evidenceIndex(_req: any, res: any) {
  const rows = await pool.query(
    "SELECT abn, tax_type, period_id, state, final_liability_cents, merkle_root, running_balance_hash FROM periods ORDER BY abn, tax_type, period_id DESC"
  );
  const list = rows.rows.map((row) => ({
    abn: row.abn,
    taxType: row.tax_type,
    periodId: row.period_id,
    state: row.state,
    final_liability_cents: Number(row.final_liability_cents ?? 0),
    merkle_root: row.merkle_root ?? null,
    running_balance_hash: row.running_balance_hash ?? null,
  }));
  return res.json(list);
}

export async function evidenceZip(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_QUERY" });
  }
  try {
    const { bundle, attachments } = await buildEvidenceBundle(abn, taxType, periodId);
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-"));
    try {
      const evidencePath = path.join(tmp, "evidence.json");
      await fs.writeFile(evidencePath, JSON.stringify(bundle, null, 2), "utf8");
      for (const file of attachments) {
        const dest = path.join(tmp, file.name);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, file.data);
      }
      const zipSafe = `evidence_${abn}_${periodId}_${taxType}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const zipName = `${zipSafe}.zip`;
      const args = ["-qr", zipName, "evidence.json", ...attachments.map((a) => a.name)];
      await execFileAsync("zip", args, { cwd: tmp });
      const zipBuffer = await fs.readFile(path.join(tmp, zipName));
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
      return res.send(zipBuffer);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}
