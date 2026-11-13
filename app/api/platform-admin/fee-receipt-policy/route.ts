import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Channel = "WhatsApp" | "Email";
const WATERMARK_BUCKET = "bizbook-company-brand-assets";

function testProjectOnly() {
  try { return isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { return false; }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function parseChannels(value: unknown): Channel[] | null {
  if (!Array.isArray(value) || value.length > 2
    || value.some((channel) => channel !== "WhatsApp" && channel !== "Email")) return null;
  const channels = value as Channel[];
  return new Set(channels).size === channels.length ? channels : null;
}

function handleError(error: unknown) {
  if (error instanceof PlatformAuthorizationError) return json({ error: error.message }, error.status);
  return json({ error: "Student fee receipt settings could not be loaded." }, 500);
}

export async function GET() {
  try {
    if (!testProjectOnly()) return json({ error: "Student fee receipt settings are available only on the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role === "support") return json({ error: "Support administrators cannot access receipt template settings." }, 403);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("platform_fee_receipt_policy")
      .select("id, delivery_channels, template_title, accent_color, header_color, footer_note, show_installment_schedule, show_payment_reference, show_institute_logo, show_bizbook_brand_mark, bizbook_brand_name, terms_note, show_watermark, watermark_size_percent, watermark_opacity_percent, watermark_logo_path, title_bold, title_pill, show_paid_seal, paid_seal_color, paid_seal_opacity_percent, paid_seal_size_percent, updated_at")
      .eq("id", true).maybeSingle();
    if (error || !data) return json({ error: "Student fee receipt settings are unavailable. Apply the company receipt template migration first." }, 503);
    let watermark_logo_url: string | null = null;
    if (data.watermark_logo_path) {
      const { data: signed } = await supabase.storage.from(WATERMARK_BUCKET).createSignedUrl(data.watermark_logo_path, 3600);
      watermark_logo_url = signed?.signedUrl ?? null;
    }
    const { watermark_logo_path: _watermarkLogoPath, ...publicPolicy } = data;
    return json({ policy: { ...publicPolicy, watermark_logo_url }, canEdit: true });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testProjectOnly()) return json({ error: "Company watermark uploads are available only on the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role === "support") return json({ error: "Company administrator access is required to upload the logo." }, 403);
    if (Number(request.headers.get("content-length") ?? 0) > 9_000_000) return json({ error: "The compressed logo is too large to store. Try an image with smaller dimensions." }, 413);
    let form: FormData;
    try { form = await request.formData(); } catch { return json({ error: "The selected image could not be read. Choose a supported image and retry." }, 400); }
    const entry = form.get("logo");
    if (!entry || typeof entry === "string" || typeof (entry as Blob).arrayBuffer !== "function" || (entry as File).size < 1 || (entry as File).size > 8 * 1024 * 1024) {
      return json({ error: "Choose a PNG, JPG, or WebP image." }, 400);
    }
    const file = entry as File;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const contentType = png ? "image/png" : jpg ? "image/jpeg" : null;
    if (!contentType || (file.type && file.type !== contentType) || file.size > 8 * 1024 * 1024) return json({ error: "The compressed logo is too large or is not a supported image." }, 400);

    const supabase = await createSupabaseServerClient();
    const logoPath = `fee-receipt-watermark/${randomUUID()}.${png ? "png" : "jpg"}`;
    const { error: uploadError } = await supabase.storage.from(WATERMARK_BUCKET).upload(logoPath, bytes, { contentType, upsert: false });
    if (uploadError) return json({ error: "The compressed logo could not be uploaded. Check the storage setup and try again." }, 503);
    const { data: signed, error: signedError } = await supabase.storage.from(WATERMARK_BUCKET).createSignedUrl(logoPath, 3600);
    if (signedError || !signed?.signedUrl) {
      await supabase.storage.from(WATERMARK_BUCKET).remove([logoPath]);
      return json({ error: "The uploaded logo could not be previewed. Check the watermark storage permissions." }, 503);
    }
    const { data: saved, error: updateError } = await supabase.rpc("set_platform_fee_receipt_watermark_logo", { p_logo_path: logoPath });
    if (updateError) {
      await supabase.storage.from(WATERMARK_BUCKET).remove([logoPath]);
      return json({ error: "The logo uploaded but could not be attached to the receipt template." }, 503);
    }
    const previousPath = saved && typeof saved === "object" && !Array.isArray(saved) && "replaced_path" in saved && typeof saved.replaced_path === "string" ? saved.replaced_path : null;
    if (previousPath && previousPath !== logoPath) await supabase.storage.from(WATERMARK_BUCKET).remove([previousPath]);
    return json({ saved: true, watermark_logo_url: signed.signedUrl });
  } catch (error) { return handleError(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testProjectOnly()) return json({ error: "Company watermark settings are available only on the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role === "support") return json({ error: "Company administrator access is required to remove the logo." }, 403);
    const supabase = await createSupabaseServerClient();
    const current = await supabase.from("platform_fee_receipt_policy").select("watermark_logo_path").eq("id", true).maybeSingle();
    if (current.error || !current.data) return json({ error: "Receipt template settings could not be loaded." }, 503);
    const { error } = await supabase.rpc("set_platform_fee_receipt_watermark_logo", { p_logo_path: null });
    if (error) return json({ error: "The logo could not be removed from the receipt template." }, 503);
    if (current.data.watermark_logo_path) await supabase.storage.from(WATERMARK_BUCKET).remove([current.data.watermark_logo_path]);
    return json({ saved: true });
  } catch (error) { return handleError(error); }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testProjectOnly()) return json({ error: "Student fee receipt settings are available only on the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role === "support") return json({ error: "Company administrator access is required to change receipt settings." }, 403);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 3_000) return json({ error: "The receipt settings are too large." }, 413);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return json({ error: "The receipt settings are invalid." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The receipt settings are invalid." }, 400);
    const value = input as Record<string, unknown>;
    const channels = parseChannels(value.delivery_channels);
    const titleLines = typeof value.template_title === "string"
      ? value.template_title.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : [];
    if (!channels || typeof value.template_title !== "string" || !titleLines.length || titleLines.length > 2 || value.template_title.trim().length > 64
      || typeof value.accent_color !== "string" || !/^#[\da-fA-F]{6}$/.test(value.accent_color)
      || typeof value.header_color !== "string" || !/^#[\da-fA-F]{6}$/.test(value.header_color)
      || typeof value.footer_note !== "string" || value.footer_note.length > 160
      || typeof value.show_installment_schedule !== "boolean" || typeof value.show_payment_reference !== "boolean"
      || typeof value.show_institute_logo !== "boolean" || typeof value.show_bizbook_brand_mark !== "boolean"
      || typeof value.bizbook_brand_name !== "string" || !value.bizbook_brand_name.trim() || value.bizbook_brand_name.trim().length > 48
      || typeof value.terms_note !== "string" || value.terms_note.length > 360
      || typeof value.show_watermark !== "boolean"
      || !Number.isInteger(value.watermark_size_percent) || Number(value.watermark_size_percent) < 15 || Number(value.watermark_size_percent) > 75
      || !Number.isInteger(value.watermark_opacity_percent) || Number(value.watermark_opacity_percent) < 3 || Number(value.watermark_opacity_percent) > 22
      || typeof value.title_bold !== "boolean" || typeof value.title_pill !== "boolean"
      || typeof value.show_paid_seal !== "boolean"
      || typeof value.paid_seal_color !== "string" || !/^#[\da-fA-F]{6}$/.test(value.paid_seal_color)
      || !Number.isInteger(value.paid_seal_opacity_percent) || Number(value.paid_seal_opacity_percent) < 0 || Number(value.paid_seal_opacity_percent) > 100
      || !Number.isInteger(value.paid_seal_size_percent) || Number(value.paid_seal_size_percent) < 60 || Number(value.paid_seal_size_percent) > 160) {
      return json({ error: "Choose valid delivery channels and complete the receipt template fields." }, 400);
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("save_platform_fee_receipt_policy_v6", {
      p_delivery_channels: channels as unknown as import("@/lib/supabase/database.types").Json,
      p_template_title: value.template_title.trim().replace(/\r\n?/g, "\n"),
      p_accent_color: value.accent_color.toUpperCase(),
      p_footer_note: value.footer_note.trim(),
      p_show_installment_schedule: value.show_installment_schedule,
      p_show_payment_reference: value.show_payment_reference,
      p_show_institute_logo: value.show_institute_logo,
      p_show_bizbook_brand_mark: value.show_bizbook_brand_mark,
      p_bizbook_brand_name: value.bizbook_brand_name.trim(),
      p_terms_note: value.terms_note.trim(),
      p_show_watermark: value.show_watermark,
      p_watermark_size_percent: Number(value.watermark_size_percent),
      p_watermark_opacity_percent: Number(value.watermark_opacity_percent),
      p_title_bold: value.title_bold,
      p_title_pill: value.title_pill,
      p_show_paid_seal: value.show_paid_seal,
      p_paid_seal_color: value.paid_seal_color.toUpperCase(),
      p_paid_seal_opacity_percent: Number(value.paid_seal_opacity_percent),
      p_paid_seal_size_percent: Number(value.paid_seal_size_percent),
      p_header_color: value.header_color.toUpperCase(),
    });
    if (error?.code === "42501") return json({ error: "Company administrator access is required." }, 403);
    if (error || !data) return json({ error: error?.message ?? "Student fee receipt settings could not be saved." }, 409);
    return json({ saved: true, policy: data });
  } catch (error) { return handleError(error); }
}
