import type { NextApiRequest, NextApiResponse } from "next";
import { Payments } from "../../../libs/paymentsClient";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  try {
    const { abn, taxType, periodId, amountCents, stp, bank } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents >= 0) {
      return res.status(400).json({ error: "Release must be negative" });
    }
    if (!stp || !bank) {
      return res.status(400).json({ error: "Missing STP or bank payload" });
    }
    const data = await Payments.payAto({ abn, taxType, periodId, amountCents, stp, bank });
    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Release failed" });
  }
}
