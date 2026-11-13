import { NextResponse } from "next/server";
import { processPlatformSubscriptionWebhook } from "@/lib/supabase/platform-subscription-webhooks";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const result = await processPlatformSubscriptionWebhook("cashfree", rawBody, request.headers);
  return NextResponse.json(result.ok ? { received: true, status: result.status } : { error: result.message }, {
    status: result.ok ? 200 : result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
