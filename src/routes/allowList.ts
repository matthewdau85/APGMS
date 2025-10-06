import { Request, Response } from "express";
import { pool } from "../db/pool";
import { appendAudit } from "../audit/appendOnly";
import { AuthenticatedUser } from "../auth/types";

export async function addDestination(req: Request, res: Response) {
  try {
    const { abn, rail, reference, account_name, account_bsb, account_number } = req.body || {};
    if (!abn || !rail || !reference) {
      return res.status(400).json({ error: "Missing fields" });
    }
    await pool.query(
      `INSERT INTO remittance_destinations (abn, rail, reference, account_name, account_bsb, account_number)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (abn, rail, reference)
       DO UPDATE SET account_name = EXCLUDED.account_name,
                     account_bsb = EXCLUDED.account_bsb,
                     account_number = EXCLUDED.account_number`,
      [abn, rail, reference, account_name ?? null, account_bsb ?? null, account_number ?? null]
    );
    const user = req.user as AuthenticatedUser | undefined;
    await appendAudit({
      actorId: user?.sub,
      action: "allow_list_upsert",
      targetType: "remittance",
      targetId: `${abn}:${rail}:${reference}`,
      payload: { abn, rail, reference, account_name, account_bsb, account_number },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Allow-list update failed", detail: String(err?.message || err) });
  }
}

export async function removeDestination(req: Request, res: Response) {
  try {
    const { abn, rail, reference } = req.body || {};
    if (!abn || !rail || !reference) {
      return res.status(400).json({ error: "Missing fields" });
    }
    await pool.query(
      `DELETE FROM remittance_destinations WHERE abn=$1 AND rail=$2 AND reference=$3`,
      [abn, rail, reference]
    );
    const user = req.user as AuthenticatedUser | undefined;
    await appendAudit({
      actorId: user?.sub,
      action: "allow_list_remove",
      targetType: "remittance",
      targetId: `${abn}:${rail}:${reference}`,
      payload: { abn, rail, reference },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Allow-list removal failed", detail: String(err?.message || err) });
  }
}
