import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type ReminderChannel = "Email" | "WhatsApp" | "Both";
type ReminderStage = { reminder_number: number; day_offset: number; channel: ReminderChannel; send_time: string };

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function testProjectOnly(): boolean {
  try { return isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { return false; }
}

function parseSchedule(value: unknown): ReminderStage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null;
  const stages: ReminderStage[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const stage = item as Record<string, unknown>;
    if (stage.reminder_number !== index + 1
      || typeof stage.day_offset !== "number" || !Number.isInteger(stage.day_offset) || stage.day_offset < -30 || stage.day_offset > 30
      || (stage.channel !== "Email" && stage.channel !== "WhatsApp" && stage.channel !== "Both")
      || typeof stage.send_time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(stage.send_time)) return null;
    stages.push({ reminder_number: index + 1, day_offset: stage.day_offset, channel: stage.channel, send_time: stage.send_time });
  }
  return stages;
}

function errorResponse(error: unknown) {
  if (error instanceof PlatformAuthorizationError) return json({ error: error.message }, error.status);
  return json({ error: "Reminder schedule settings could not be loaded." }, 500);
}

export async function GET() {
  try {
    if (!testProjectOnly()) return json({ error: "Reminder settings are available only on the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role === "support") return json({ error: "Support administrators cannot view reminder settings." }, 403);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("platform_reminder_policy")
      .select("id, is_enabled, schedule, updated_at").eq("id", true).maybeSingle();
    if (error || !data) return json({ error: "Reminder schedule is unavailable. Apply the platform reminder schedule migration first." }, 503);
    return json({ policy: data, canEdit: true });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testProjectOnly()) return json({ error: "Reminder settings are available only on the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role === "support") return json({ error: "Company administrator access is required to change the reminder schedule." }, 403);
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 8_000) return json({ error: "The reminder schedule is too large." }, 413);
    let input: unknown;
    try { input = JSON.parse(body); } catch { return json({ error: "The reminder schedule is invalid." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The reminder schedule is invalid." }, 400);
    const record = input as Record<string, unknown>;
    const schedule = parseSchedule(record.schedule);
    if (typeof record.is_enabled !== "boolean" || !schedule) {
      return json({ error: "Use one to five reminder stages. Set each date offset, channel, and local send time." }, 400);
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("save_platform_reminder_policy", {
      p_is_enabled: record.is_enabled,
      p_schedule: schedule as unknown as import("@/lib/supabase/database.types").Json,
    });
    if (error?.code === "42501") return json({ error: "Platform owner access is required." }, 403);
    if (error || !data) return json({ error: error?.message ?? "The reminder schedule could not be saved." }, 409);
    return json({ saved: true, policy: data });
  } catch (error) { return errorResponse(error); }
}
