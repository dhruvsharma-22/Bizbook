import { after, NextResponse } from "next/server";
import { processProviderWebhook } from "@/lib/supabase/payment-webhooks";
import { dispatchFeeReceiptForPayment } from "@/lib/supabase/payment-receipts";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const result = await processProviderWebhook("razorpay", await request.text(), request.headers);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.httpStatus, headers });
  if (result.status === "captured" && result.paymentId) {
    after(async () => { try { await dispatchFeeReceiptForPayment(result.paymentId as string); } catch { /* The payment and queued receipt remain durable for retry. */ } });
  }
  return NextResponse.json({ received: true, status: result.status }, { status: 200, headers });
}
