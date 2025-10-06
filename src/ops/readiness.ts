import type { Request, Response } from "express";
import { Pool } from "pg";

const pool = new Pool();

export type ReadinessTier = "prototype" | "real";

export interface ReadinessCheck {
  id: string;
  label: string;
  tier: ReadinessTier;
  passed: boolean;
  detail: string;
  observedAt: string;
}

interface PeriodContext {
  abn?: string;
  taxType?: string;
  periodId?: string;
}

type CheckRunner = () => Promise<string> | string;

async function runCheck(
  checks: ReadinessCheck[],
  id: string,
  label: string,
  tier: ReadinessTier,
  runner: CheckRunner
) {
  const observedAt = new Date().toISOString();
  try {
    const detail = await runner();
    checks.push({ id, label, tier, passed: true, detail, observedAt });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    checks.push({ id, label, tier, passed: false, detail, observedAt });
  }
}

function computeScore(checks: ReadinessCheck[], tier?: ReadinessTier) {
  const relevant = tier ? checks.filter(c => c.tier === tier) : checks;
  if (relevant.length === 0) return 100;
  const passed = relevant.filter(c => c.passed).length;
  return Math.round((passed / relevant.length) * 100);
}

export async function readiness(_req: Request, res: Response) {
  const checks: ReadinessCheck[] = [];
  const context: PeriodContext = {};
  const fallbackAbn = process.env.APGMS_DEFAULT_ABN ?? "12345678901";
  const fallbackTax = process.env.APGMS_DEFAULT_TAX ?? "GST";

  await runCheck(checks, "postgres", "Postgres reachable", "real", async () => {
    const { rows } = await pool.query<{ now: Date }>("select now()");
    const ts = rows[0]?.now instanceof Date ? rows[0].now.toISOString() : String(rows[0]?.now ?? "?");
    return `Connected (db time ${ts})`;
  });

  await runCheck(checks, "rpt-key", "RPT signing key configured", "real", () => {
    if (!process.env.RPT_ED25519_SECRET_BASE64) {
      throw new Error("RPT_ED25519_SECRET_BASE64 not set");
    }
    return "Ed25519 secret present";
  });

  await runCheck(checks, "allowlist", "Remittance allow-list seeded", "real", async () => {
    const { rows } = await pool.query<{
      abn: string;
      rail: string;
      reference: string;
    }>("select abn, rail, reference from remittance_destinations limit 1");
    if (!rows.length) {
      throw new Error("remittance_destinations table is empty");
    }
    const row = rows[0];
    return `Sample allow-list: ${row.abn}/${row.rail}/${row.reference}`;
  });

  await runCheck(checks, "period", "Latest period staged for release", "prototype", async () => {
    const { rows } = await pool.query<{
      abn: string;
      tax_type: string;
      period_id: string;
      state: string;
      credited_to_owa_cents: string | number | null;
      final_liability_cents: string | number | null;
    }>(
      "select abn, tax_type, period_id, state, credited_to_owa_cents, final_liability_cents " +
        "from periods order by id desc limit 1"
    );
    if (!rows.length) {
      throw new Error("periods table is empty");
    }
    const row = rows[0];
    context.abn = row.abn ?? fallbackAbn;
    context.taxType = row.tax_type ?? fallbackTax;
    context.periodId = row.period_id;
    const credited = Number(row.credited_to_owa_cents ?? 0);
    const liability = Number(row.final_liability_cents ?? 0);
    const okStates = new Set(["CLOSING", "READY_RPT", "RELEASED"]);
    if (!okStates.has(row.state)) {
      throw new Error(`latest period ${row.period_id} still ${row.state}`);
    }
    return `Period ${row.period_id} (${row.tax_type}) state=${row.state} credited=${credited} liability=${liability}`;
  });

  await runCheck(checks, "ledger", "OWA ledger matches credited total", "prototype", async () => {
    if (!context.abn || !context.taxType || !context.periodId) {
      throw new Error("no baseline period to compare (see period check)");
    }
    const { rows } = await pool.query<{
      credited_to_owa_cents: string | number | null;
      ledger_credited: string | number | null;
      ledger_net: string | number | null;
    }>(
      `select p.credited_to_owa_cents,` +
        ` coalesce(sum(case when l.amount_cents > 0 then l.amount_cents else 0 end),0) as ledger_credited,` +
        ` coalesce(sum(l.amount_cents),0) as ledger_net` +
        ` from periods p` +
        ` left join owa_ledger l on l.abn=p.abn and l.tax_type=p.tax_type and l.period_id=p.period_id` +
        ` where p.abn=$1 and p.tax_type=$2 and p.period_id=$3` +
        ` group by p.credited_to_owa_cents`,
      [context.abn, context.taxType, context.periodId]
    );
    if (!rows.length) {
      throw new Error("period ledger summary missing");
    }
    const row = rows[0];
    const credited = Number(row.credited_to_owa_cents ?? 0);
    const ledgerCredited = Number(row.ledger_credited ?? 0);
    const ledgerNet = Number(row.ledger_net ?? 0);
    if (credited !== ledgerCredited) {
      throw new Error(
        `period credited ${credited} != ledger credited ${ledgerCredited}`
      );
    }
    if (ledgerNet < 0) {
      throw new Error(`ledger net balance negative (${ledgerNet})`);
    }
    return `Ledger credited ${ledgerCredited} (net ${ledgerNet})`;
  });

  await runCheck(checks, "rpt", "RPT token issued for period", "real", async () => {
    if (!context.abn || !context.taxType || !context.periodId) {
      throw new Error("no baseline period to inspect (see period check)");
    }
    const { rows } = await pool.query<{
      status: string;
      created_at: Date;
    }>(
      `select status, created_at from rpt_tokens` +
        ` where abn=$1 and tax_type=$2 and period_id=$3` +
        ` order by created_at desc limit 1`,
      [context.abn, context.taxType, context.periodId]
    );
    if (!rows.length) {
      throw new Error("no rpt_tokens rows for period");
    }
    const row = rows[0];
    const acceptable = new Set(["ISSUED", "READY_RPT", "active", "pending"]);
    if (!acceptable.has(row.status)) {
      throw new Error(`latest RPT status ${row.status}`);
    }
    const ts = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
    return `RPT ${row.status} @ ${ts}`;
  });

  const prototypeScore = computeScore(checks);
  const realScore = computeScore(checks, "real");

  res.json({ prototypeScore, realScore, checks });
}
