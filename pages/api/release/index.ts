import type { NextApiRequest, NextApiResponse } from "next";
import { Payments } from "../../../libs/paymentsClient";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  try {
    const { abn, taxType, periodId, amountCents, currency, mode, reversal } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number" || !currency) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents <= 0 && !reversal) {
      return res.status(400).json({ error: "Release must be positive" });
    }
    const data = await Payments.payAto({ abn, taxType, periodId, amountCents, currency, mode, reversal });
    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Release failed" });
  }
}
