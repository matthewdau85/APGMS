import type { NextApiRequest, NextApiResponse } from "next";
import { Payments } from "../../../libs/paymentsClient";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  try {
    const { abn, taxType, periodId, amountCents, destination } = req.body || {};
    if (!abn || !taxType || !periodId || typeof amountCents !== "number" || !destination) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (amountCents >= 0) {
      return res.status(400).json({ error: "Release must be negative" });
    }
    const idem = req.headers["idempotency-key"];
    const headers: Record<string, string> = {};
    if (typeof idem === "string" && idem) headers["Idempotency-Key"] = idem;
    if (Array.isArray(idem) && idem.length) headers["Idempotency-Key"] = idem[0];
    const opts = Object.keys(headers).length ? { headers } : undefined;
    const data = await Payments.payAto({ abn, taxType, periodId, amountCents, destination }, opts);
    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Release failed" });
  }
}
