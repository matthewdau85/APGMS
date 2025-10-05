import type { NextApiRequest, NextApiResponse } from "next";
import { Payments } from "../../../libs/paymentsClient";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }
    const data = await Payments.evidence({ abn, taxType, periodId });
    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Evidence failed" });
  }
}
