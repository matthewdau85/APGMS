import type { NextApiRequest, NextApiResponse } from "next";
import { Payments } from "../../../libs/paymentsClient";
import { MoneyCents, expectMoneyCents, toCents } from "../../../libs/money";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing fields" });
    }
    let cents: MoneyCents;
    try {
      cents = expectMoneyCents(amountCents, "amountCents");
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Invalid amount" });
    }
    if (toCents(cents) <= 0) {
      return res.status(400).json({ error: "Deposit must be positive" });
    }
    const data = await Payments.deposit({ abn, taxType, periodId, amountCents: cents });
    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Deposit failed" });
  }
}
