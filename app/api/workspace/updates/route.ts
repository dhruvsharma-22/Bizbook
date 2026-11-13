import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function instituteIdIsValid(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100;
}

export async function GET(request: Request) {
  const instituteId = new URL(request.url).searchParams.get("instituteId");
  if (!instituteIdIsValid(instituteId)) return json({ error: "Institute selection is invalid." }, 400);
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return json({ error: "Sign in to view workspace updates." }, 401);
  const { data, error } = await supabase.rpc("list_workspace_updates", { p_institute_id: instituteId });
  if (error) return json({ error: error.code === "42501" ? "You do not have access to this institute." : "Workspace updates could not be loaded." }, error.code === "42501" ? 403 : 503);
  return json({ updates: data });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 12_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The request body is invalid." }, 400);
  const record = input as Record<string, unknown>;
  if (!instituteIdIsValid(record.instituteId) || !Array.isArray(record.keys)
      || record.keys.length > 50 || record.keys.some((key) => typeof key !== "string" || key.length > 180)) {
    return json({ error: "Notification fields are invalid." }, 400);
  }
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return json({ error: "Sign in to update notification status." }, 401);
  const { data, error } = await supabase.rpc("mark_workspace_updates_read", {
    p_institute_id: record.instituteId,
    p_notification_keys: record.keys as string[],
  });
  if (error) return json({ error: error.code === "42501" ? "You do not have access to this institute." : "Notification status could not be saved." }, error.code === "42501" ? 403 : 503);
  return json({ marked: data ?? 0 });
}
