import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import { parseSupportReplyInput, parseSupportStateInput, SUPPORT_STATUSES } from "@/lib/supabase/support-validation";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function testProjectOnly(): boolean {
  try { return isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { return false; }
}

function errorResponse(error: unknown) {
  if (error instanceof PlatformAuthorizationError) return json({ error: error.message }, error.status);
  return json({ error: "The platform support operation could not be completed." }, 503);
}

function rpcStatus(code?: string): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23505" || code === "23514") return 409;
  if (code === "22023") return 400;
  return 503;
}

export async function GET(request: Request) {
  try {
    if (!testProjectOnly()) return json({ error: "Platform support is available only on the authorized test project." }, 503);
    await requirePlatformAdministrator();
    const params = new URL(request.url).searchParams;
    const rawStatus = params.get("status");
    const status = rawStatus && SUPPORT_STATUSES.some((value) => value === rawStatus) ? rawStatus : rawStatus ? "invalid" : null;
    if (status === "invalid") return json({ error: "Support status filter is invalid." }, 400);
    const rawLimit = Number(params.get("limit") ?? "50");
    const rawOffset = Number(params.get("offset") ?? "0");
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100
        || !Number.isInteger(rawOffset) || rawOffset < 0 || rawOffset > 10000) {
      return json({ error: "Support pagination values are invalid." }, 400);
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("list_platform_support_tickets", {
      p_status: status,
      p_limit: rawLimit,
      p_offset: rawOffset,
    });
    if (error) return json({ error: "Platform support requests could not be loaded." }, rpcStatus(error.code));
    return json({ result: data });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testProjectOnly()) return json({ error: "Platform support is available only on the authorized test project." }, 503);
    await requirePlatformAdministrator();
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_384) return json({ error: "The request body is too large." }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "The request body is invalid." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "The request body is invalid." }, 400);
    const input = body as Record<string, unknown>;
    const supabase = await createSupabaseServerClient();
    if (input.action === "state") {
      const state = parseSupportStateInput(input);
      if (!state) return json({ error: "Support state fields are invalid." }, 400);
      const { data, error } = await supabase.rpc("set_platform_support_ticket_state", {
        p_ticket_id: state.ticketId, p_status: state.status, p_priority: state.priority,
      });
      if (error) return json({ error: "Support state could not be updated." }, rpcStatus(error.code));
      return json({ result: data });
    }
    if (input.action === "reply") {
      const reply = parseSupportReplyInput(input);
      if (!reply) return json({ error: "Support reply fields are invalid." }, 400);
      const { data, error } = await supabase.rpc("reply_platform_support_ticket", {
        p_ticket_id: reply.ticketId, p_message: reply.message, p_idempotency_key: reply.idempotencyKey,
      });
      if (error) return json({ error: "The support response could not be saved." }, rpcStatus(error.code));
      return json({ messageId: data });
    }
    return json({ error: "This platform support action is not supported." }, 400);
  } catch (error) { return errorResponse(error); }
}
