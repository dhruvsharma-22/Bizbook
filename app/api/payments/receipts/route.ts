import { after, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { dispatchFeeReceipt, loadPlatformFeeReceiptPolicy, type FeeReceiptPolicy } from "@/lib/supabase/payment-receipts";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const roles = ["owner", "administrator", "accountant"] as const;

type ManualFeePayment = {
  id: string;
  institute_id: string;
  branch_id: string | null;
  student_id: string;
  payment_date: string;
  receipt_kind: string;
  mode: string;
  status: string;
  created_by: string | null;
  verified_at?: string | null;
};

function receiptNumber(paymentDate: string) {
  return `BBR-${paymentDate.replaceAll("-", "")}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

async function ensureManualFeeReceipt(admin: ReturnType<typeof createSupabaseAdminClient>, payment: ManualFeePayment) {
  const { data, error } = await admin.from("fee_receipts").upsert({
    institute_id: payment.institute_id,
    branch_id: payment.branch_id,
    student_id: payment.student_id,
    payment_id: payment.id,
    receipt_number: receiptNumber(payment.payment_date),
  }, { onConflict: "payment_id", ignoreDuplicates: true }).select("id, institute_id, branch_id").maybeSingle();
  if (error) throw new Error("The fee receipt could not be created.");
  if (data) return data;
  const { data: existing, error: lookupError } = await admin.from("fee_receipts")
    .select("id, institute_id, branch_id").eq("payment_id", payment.id).maybeSingle();
  if (lookupError || !existing) throw new Error("The fee receipt could not be loaded after creation.");
  return existing;
}

async function loadReceiptPreviewPolicy(
  session: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  admin: ReturnType<typeof createSupabaseAdminClient> | null,
): Promise<FeeReceiptPolicy | null> {
  const { data, error } = await session.from("platform_fee_receipt_policy")
    .select("delivery_channels, template_title, accent_color, header_color, footer_note, terms_note, show_installment_schedule, show_payment_reference, show_institute_logo, show_bizbook_brand_mark, bizbook_brand_name, show_watermark, watermark_size_percent, watermark_opacity_percent, watermark_logo_path, title_bold, title_pill, show_paid_seal, paid_seal_color, paid_seal_opacity_percent, paid_seal_size_percent, updated_at")
    .eq("id", true).maybeSingle();
  if (error || !data || !Array.isArray(data.delivery_channels)
    || data.delivery_channels.some((channel) => channel !== "WhatsApp" && channel !== "Email")
    || !/^#[\da-fA-F]{6}$/.test(data.accent_color)) return null;
  if (!/^#[\da-fA-F]{6}$/.test(data.header_color)) return null;

  let watermarkLogoUrl: string | null = null;
  if (data.watermark_logo_path) {
    try {
      const storage = admin?.storage ?? session.storage;
      const { data: signed } = await storage.from("bizbook-company-brand-assets")
        .createSignedUrl(data.watermark_logo_path, 3600);
      watermarkLogoUrl = signed?.signedUrl ?? null;
    } catch { /* A private watermark asset must not block the receipt list. */ }
  }
  return {
    delivery_channels: data.delivery_channels as FeeReceiptPolicy["delivery_channels"],
    template_title: data.template_title,
    accent_color: data.accent_color,
    header_color: data.header_color,
    footer_note: data.footer_note,
    terms_note: data.terms_note,
    show_installment_schedule: true,
    show_payment_reference: data.show_payment_reference,
    show_institute_logo: data.show_institute_logo,
    show_bizbook_brand_mark: data.show_bizbook_brand_mark,
    bizbook_brand_name: data.bizbook_brand_name,
    show_watermark: data.show_watermark,
    watermark_size_percent: data.watermark_size_percent,
    watermark_opacity_percent: data.watermark_opacity_percent,
    watermark_logo_url: watermarkLogoUrl,
    title_bold: data.title_bold,
    title_pill: data.title_pill,
    show_paid_seal: data.show_paid_seal,
    paid_seal_color: data.paid_seal_color,
    paid_seal_opacity_percent: data.paid_seal_opacity_percent,
    paid_seal_size_percent: data.paid_seal_size_percent,
    updated_at: data.updated_at,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const instituteId = url.searchParams.get("instituteId")?.trim() ?? "";
  const branchId = url.searchParams.get("branchId")?.trim() || undefined;
  if (!instituteId) return json({ error: "Choose an institute to view fee receipts." }, 400);
  let previewAccessGranted = false;
  try {
    const access = await requireInstituteAccess(instituteId, { allowedRoles: roles, ...(branchId ? { branchId } : {}) });
    if (access.accessScope === "branches" && !branchId) return json({ error: "Choose one of your permitted branches to view fee receipts." }, 403);
    previewAccessGranted = true;
    const session = await createSupabaseServerClient();
    let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
    try { admin = createSupabaseAdminClient(); } catch { /* Browsing receipts only needs the signed-in institute session. */ }
    const loadReceiptRows = () => {
      let query = session.from("fee_receipts").select("id, institute_id, branch_id, student_id, payment_id, receipt_number, created_at")
        .eq("institute_id", instituteId).order("created_at", { ascending: false }).limit(250);
      if (branchId) {
        query = access.accessScope === "institute"
          ? query.or(`branch_id.eq.${branchId},branch_id.is.null`)
          : query.eq("branch_id", branchId);
      }
      return query;
    };
    let receiptResult = await loadReceiptRows();
    if (receiptResult.error) return json({ error: "Fee receipt history could not be loaded for this workspace." }, 503);
    let receiptRows = receiptResult.data ?? [];

    // Recover paid fee records made before receipt automation was active when the
    // server has write credentials. This is best-effort and never blocks reading receipts.
    let manualPaymentsQuery = session.from("payments")
      .select("id, institute_id, branch_id, student_id, payment_date, receipt_kind, mode, status, created_by, verified_at")
      .eq("institute_id", instituteId).eq("receipt_kind", "Fee")
      .in("status", ["Paid", "Partially Refunded"])
      .order("created_at", { ascending: false }).limit(250);
    if (branchId) {
      manualPaymentsQuery = access.accessScope === "institute"
        ? manualPaymentsQuery.or(`branch_id.eq.${branchId},branch_id.is.null`)
        : manualPaymentsQuery.eq("branch_id", branchId);
    }
    const { data: manualPayments, error: manualPaymentsError } = await manualPaymentsQuery;
    if (manualPaymentsError) return json({ error: "Recorded fee payments could not be checked." }, 503);
    const knownPaymentIds = new Set(receiptRows.map((receipt) => receipt.payment_id));
    const missingManualPayments = ((manualPayments ?? []) as ManualFeePayment[]).filter((payment) =>
      !knownPaymentIds.has(payment.id)
      && (payment.mode === "Manual" || (payment.mode === "Online" && Boolean(payment.verified_at)))
    );
    if (missingManualPayments.length && admin) {
      const { error: backfillError } = await admin.from("fee_receipts").upsert(missingManualPayments.map((payment) => ({
        institute_id: payment.institute_id,
        branch_id: payment.branch_id,
        student_id: payment.student_id,
        payment_id: payment.id,
        receipt_number: receiptNumber(payment.payment_date),
      })), { onConflict: "payment_id", ignoreDuplicates: true });
      if (!backfillError) {
        receiptResult = await loadReceiptRows();
        if (!receiptResult.error) receiptRows = receiptResult.data ?? [];
      }
    }
    const paymentIds = [...new Set(receiptRows.map((row) => row.payment_id))];
    const studentIds = [...new Set(receiptRows.map((row) => row.student_id))];
    const receiptIds = receiptRows.map((row) => row.id);
    const [paymentsResult, studentsResult, deliveriesResult, instituteResult, scheduleResult, allocationsResult, policy] = await Promise.all([
      paymentIds.length ? session.from("payments").select("id, receipt_kind, amount, payment_date, method, status, provider_reference, note").in("id", paymentIds) : Promise.resolve({ data: [], error: null }),
      studentIds.length ? session.from("students").select("id, name, parent_name, parent_email, parent_mobile, whatsapp").in("id", studentIds) : Promise.resolve({ data: [], error: null }),
      receiptIds.length ? session.from("fee_receipt_deliveries").select("id, receipt_id, channel, delivery_status, attempt_count, retryable, last_error_code, sent_at, attempted_at").in("receipt_id", receiptIds) : Promise.resolve({ data: [], error: null }),
      session.from("coaching_institutes").select("business_name, owner_name, phone, whatsapp, email, website, address, city, state, pincode, gstin, logo_path").eq("id", instituteId).maybeSingle(),
      studentIds.length ? session.from("installment_balances").select("installment_id, student_id, sequence_number, scheduled_amount, due_date, paid_amount, outstanding_amount, balance_status").eq("institute_id", instituteId).in("student_id", studentIds).neq("balance_status", "Cancelled").order("sequence_number") : Promise.resolve({ data: [], error: null }),
      studentIds.length ? session.from("payment_allocations").select("student_id, installment_id, payment_id, allocation_kind").eq("institute_id", instituteId).in("student_id", studentIds).eq("allocation_kind", "Fee") : Promise.resolve({ data: [], error: null }),
      loadReceiptPreviewPolicy(session, admin),
    ]);
    if (paymentsResult.error || studentsResult.error || deliveriesResult.error || instituteResult.error || scheduleResult.error || allocationsResult.error || !instituteResult.data) {
      return json({ error: "Receipt details could not be loaded. Check the workspace data permissions and retry." }, 503);
    }
    const allocationPaymentIds = [...new Set((allocationsResult.data ?? []).map((item) => item.payment_id))];
    const paidDateMap = new Map<string, string>();
    if (allocationPaymentIds.length) {
      const { data: allocationPayments, error } = await session.from("payments").select("id, payment_date, status")
        .in("id", allocationPaymentIds).eq("institute_id", instituteId).in("status", ["Paid", "Partially Refunded"]);
      if (error) return json({ error: "Installment payment dates could not be loaded." }, 503);
      for (const row of allocationPayments ?? []) paidDateMap.set(row.id, row.payment_date);
    }
    let instituteLogoUrl: string | null = null;
    if (instituteResult.data.logo_path && admin) {
      try {
        const { data: signedLogo } = await admin.storage.from("bizbook-institute-logos").createSignedUrl(instituteResult.data.logo_path, 3600);
        instituteLogoUrl = signedLogo?.signedUrl ?? null;
      } catch { /* An unavailable logo must not block receipt history or its preview. */ }
    } else if (instituteResult.data.logo_path) {
      try {
        const { data: signedLogo } = await session.storage.from("bizbook-institute-logos").createSignedUrl(instituteResult.data.logo_path, 3600);
        instituteLogoUrl = signedLogo?.signedUrl ?? null;
      } catch { /* The private institute logo is optional for receipt history. */ }
    }
    const paymentMap = new Map((paymentsResult.data ?? []).map((row) => [row.id, row]));
    const studentMap = new Map((studentsResult.data ?? []).map((row) => [row.id, row]));
    const deliveryMap = new Map<string, typeof deliveriesResult.data>();
    for (const row of deliveriesResult.data ?? []) deliveryMap.set(row.receipt_id, [...(deliveryMap.get(row.receipt_id) ?? []), row]);
    const schedules = new Map<string, Array<Record<string, unknown>>>();
    for (const row of scheduleResult.data ?? []) schedules.set(row.student_id, [...(schedules.get(row.student_id) ?? []), row as unknown as Record<string, unknown>]);
    const dates = new Map<string, string[]>();
    for (const allocation of allocationsResult.data ?? []) {
      const paymentDate = paidDateMap.get(allocation.payment_id);
      if (!paymentDate) continue;
      const key = `${allocation.student_id}:${allocation.installment_id}`;
      const existing = dates.get(key) ?? [];
      if (!existing.includes(paymentDate)) existing.push(paymentDate);
      dates.set(key, existing);
    }
    for (const value of dates.values()) value.sort();
    return json({
      institute: { ...instituteResult.data, logo_url: instituteLogoUrl },
      policy,
      receipts: receiptRows.map((receipt) => ({
        ...receipt,
        payment: paymentMap.get(receipt.payment_id) ?? null,
        student: studentMap.get(receipt.student_id) ?? null,
        deliveries: deliveryMap.get(receipt.id) ?? [],
        schedule: (schedules.get(receipt.student_id) ?? []).map((item) => ({
          ...item,
          paid_dates: dates.get(`${receipt.student_id}:${String(item.installment_id)}`) ?? [],
        })),
      })),
    });
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    if (previewAccessGranted) return json({ error: "Receipt history could not be loaded." }, 503);
    return json({ error: "Fee receipt records are unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  try { if (!origin || new URL(origin).origin !== new URL(request.url).origin) return json({ error: "The request origin could not be verified." }, 403); }
  catch { return json({ error: "The request origin could not be verified." }, 403); }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 2_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The request body is invalid." }, 400);
  const value = input as Record<string, unknown>;
  const receiptIdInput = typeof value.receiptId === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value.receiptId) ? value.receiptId : null;
  const paymentIdInput = typeof value.paymentId === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value.paymentId) ? value.paymentId : null;
  if ((!receiptIdInput && !paymentIdInput) || value.channels !== undefined) {
    return json({ error: "Choose a receipt. Receipt delivery channels are managed by BizBook." }, 400);
  }
  try {
    const admin = createSupabaseAdminClient();
    const query = admin.from("fee_receipts").select("id, institute_id, branch_id");
    let { data: receipt, error } = receiptIdInput
      ? await query.eq("id", receiptIdInput).maybeSingle()
      : await query.eq("payment_id", paymentIdInput as string).maybeSingle();
    if (error) return json({ error: "The fee receipt is unavailable in this workspace." }, 404);
    let access: Awaited<ReturnType<typeof requireInstituteAccess>> | null = null;
    if (!receipt && paymentIdInput && !receiptIdInput) {
      const { data: payment, error: paymentError } = await admin.from("payments")
        .select("id, institute_id, branch_id, student_id, payment_date, receipt_kind, mode, status, created_by, verified_at")
        .eq("id", paymentIdInput).maybeSingle();
      if (paymentError || !payment) return json({ error: "The fee receipt is unavailable in this workspace." }, 404);
      access = await requireInstituteAccess(payment.institute_id, { allowedRoles: roles, ...(payment.branch_id ? { branchId: payment.branch_id } : {}) });
      if (access.accessScope === "branches" && !payment.branch_id) return json({ error: "This receipt is outside your permitted branches." }, 403);
      const manualPayment = payment as ManualFeePayment;
      if (manualPayment.receipt_kind !== "Fee" || manualPayment.mode !== "Manual"
        || !["Paid", "Partially Refunded"].includes(manualPayment.status)) {
        return json({ error: "Only recorded paid manual fee payments can create a fee receipt." }, 409);
      }
      try {
        receipt = await ensureManualFeeReceipt(admin, manualPayment);
      } catch {
        return json({ error: "The manual payment was saved, but its receipt could not be prepared." }, 503);
      }
    }
    if (!receipt) return json({ error: "The fee receipt is unavailable in this workspace." }, 404);
    access ??= await requireInstituteAccess(receipt.institute_id, { allowedRoles: roles, ...(receipt.branch_id ? { branchId: receipt.branch_id } : {}) });
    if (access.accessScope === "branches" && !receipt.branch_id) return json({ error: "This receipt is outside your permitted branches." }, 403);
    if (paymentIdInput && !receiptIdInput) {
      const policy = await loadPlatformFeeReceiptPolicy();
      after(async () => { try { await dispatchFeeReceipt(receipt.id); } catch { /* The receipt delivery row remains queued for retry. */ } });
      return json({ delivered: policy.delivery_channels.map((channel) => ({ channel, status: "Queued" })) }, 202);
    }
    const deliveries = await dispatchFeeReceipt(receipt.id);
    return json({ delivered: deliveries });
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    return json({ error: "Receipt delivery could not be started. The recorded payment remains saved." }, 503);
  }
}
