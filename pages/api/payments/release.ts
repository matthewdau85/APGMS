// app/api/payments/deposit/route.ts
import { NextResponse } from "next/server";
import { Payments } from "@/libs/paymentsClient";

export async function POST(req: Request) {
  try {
    const { abn, taxType, periodId, amountCents, currency, mode, reversal } = await req.json();
    if (typeof amountCents !== "number" || !currency) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (amountCents <= 0 && !reversal) {
      return NextResponse.json({ error: "Release must be positive" }, { status: 400 });
    }
    const out = await Payments.payAto({ abn, taxType, periodId, amountCents, currency, mode, reversal });
    return NextResponse.json(out);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Release failed" }, { status: 400 });
  }
}
