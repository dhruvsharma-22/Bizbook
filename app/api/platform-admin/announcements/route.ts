import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

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
  return json({ error: "Company updates could not be changed." }, 500);
}

export async function GET() {
  try {
    if (!testProjectOnly()) return json({ error: "Platform operations are limited to the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role === "support") return json({ error: "Only company operators can manage announcements." }, 403);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("platform_announcements")
      .select("id, title, body, is_published, published_at, created_at, updated_at")
      .order("updated_at", { ascending: false }).limit(50);
    if (error) return json({ error: "Company updates could not be loaded." }, 503);
    return json({ announcements: data ?? [] });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testProjectOnly()) return json({ error: "Platform operations are limited to the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role === "support") return json({ error: "Only company operators can publish announcements." }, 403);
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 8_000) return json({ error: "The request body is too large." }, 413);
    let input: unknown;
    try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The request body is invalid." }, 400);
    const record = input as Record<string, unknown>;
    const id = record.id === null || record.id === "" ? null : typeof record.id === "string" ? record.id : undefined;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (id === undefined || (id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        || title.length < 1 || title.length > 120 || message.length < 1 || message.length > 2000
        || typeof record.isPublished !== "boolean") {
      return json({ error: "Enter an update title, message, and publish status." }, 400);
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("save_platform_announcement", {
      p_announcement_id: id,
      p_title: title,
      p_body: message,
      p_is_published: record.isPublished,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503;
      return json({ error: status === 403 ? "Company operator access is required." : "The update could not be published." }, status);
    }
    return json({ id: data });
  } catch (error) { return errorResponse(error); }
}
