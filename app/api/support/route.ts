import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import { parseSupportReplyInput, parseSupportTicketInput } from "@/lib/supabase/support-validation";

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

function rpcStatus(code?: string): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23505" || code === "23514") return 409;
  if (code === "22023") return 400;
  if (code === "54000") return 429;
  return 503;
}

export async function GET(request: Request) {
  if (!testProjectOnly()) return json({ error: "Support is available only on the authorized test project." }, 503);
  const params = new URL(request.url).searchParams;
  const instituteId = params.get("instituteId")?.trim();
  if (!instituteId || instituteId.length > 100) return json({ error: "An institute is required." }, 400);
  const limit = Number(params.get("limit") ?? "20");
  const offset = Number(params.get("offset") ?? "0");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    return json({ error: "Support pagination values are invalid." }, 400);
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("list_my_platform_support_tickets", {
      p_institute_id: instituteId, p_limit: limit, p_offset: offset,
    });
    if (error) return json({ error: "Support requests could not be loaded." }, rpcStatus(error.code));
    return json({ result: data });
  } catch {
    return json({ error: "Support requests could not be loaded." }, 503);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  if (!testProjectOnly()) return json({ error: "Support is available only on the authorized test project." }, 503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 16_384) return json({ error: "The request body is too large." }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "The request body is invalid." }, 400);
  const input = body as Record<string, unknown>;
  try {
    const supabase = await createSupabaseServerClient();
    if (input.action === "create") {
      const ticket = parseSupportTicketInput(input);
      if (!ticket) return json({ error: "Support ticket fields are invalid." }, 400);
      const { data, error } = await supabase.rpc("create_platform_support_ticket", {
        p_institute_id: ticket.instituteId,
        p_category: ticket.category,
        p_subject: ticket.subject,
        p_message: ticket.message,
        p_idempotency_key: ticket.idempotencyKey,
      });
      if (error) return json({ error: "The support request could not be created." }, rpcStatus(error.code));
      return json({ ticketId: data }, 201);
    }
    if (input.action === "reply") {
      const reply = parseSupportReplyInput(input);
      if (!reply) return json({ error: "Support reply fields are invalid." }, 400);
      const { data, error } = await supabase.rpc("reply_platform_support_ticket", {
        p_ticket_id: reply.ticketId,
        p_message: reply.message,
        p_idempotency_key: reply.idempotencyKey,
      });
      if (error) return json({ error: "The support reply could not be saved." }, rpcStatus(error.code));
      return json({ messageId: data });
    }
    return json({ error: "This support action is not supported." }, 400);
  } catch {
    return json({ error: "The support request could not be completed." }, 503);
  }
}
