// app/api/payments/deposit/route.ts
import { NextResponse } from "next/server";
import { Payments } from "@/libs/paymentsClient";

export async function POST(req: Request) {
  try {
    const { abn, taxType, periodId, amountCents } = await req.json();
    if (amountCents <= 0) return NextResponse.json({ error: "Deposit must be positive" }, { status: 400 });
    const out = await Payments.deposit({ abn, taxType, periodId, amountCents }, { req });
    return NextResponse.json(out);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Deposit failed" }, { status: 400 });
  }
}
