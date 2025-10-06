import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { getSimRail } from "../adapters/bank/index.js";

const sim = getSimRail();

export async function simEft(req: Request, res: Response) {
  const rawIdem = req.header("idempotency-key") ?? randomUUID();
  const { amount_cents, bsb, account, reference } = req.body ?? {};
  const result = await sim.eft({
    amount_cents: Number(amount_cents),
    bsb: String(bsb ?? ""),
    account: String(account ?? ""),
    reference: reference ?? "Sim EFT",
    idempotencyKey: rawIdem,
  });
  res.json(result);
}

export async function simBpay(req: Request, res: Response) {
  const rawIdem = req.header("idempotency-key") ?? randomUUID();
  const { amount_cents, biller_code, crn, reference } = req.body ?? {};
  const result = await sim.bpay({
    amount_cents: Number(amount_cents),
    biller_code: String(biller_code ?? "75556"),
    crn: String(crn ?? ""),
    reference: reference ?? "Sim BPAY",
    idempotencyKey: rawIdem,
  });
  res.json(result);
}

export function simReconFile(req: Request, res: Response) {
  const sinceParam = req.query.since ? new Date(String(req.query.since)) : undefined;
  const settlements = sim.listSettlements(sinceParam && !isNaN(sinceParam.getTime()) ? sinceParam : undefined);
  if ((req.query.format ?? "json") === "csv") {
    const header = "provider_ref,amount_cents,paid_at,rail";
    const rows = settlements.map((s) => `${s.provider_ref},${s.amount_cents},${s.paid_at},${s.rail}`);
    res.type("text/csv").send([header, ...rows].join("\n"));
    return;
  }
  res.json({ settlements });
}
