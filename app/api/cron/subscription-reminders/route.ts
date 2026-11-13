import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getLocalDateInTimeZone,
  getLocalTimeInTimeZone,
  getScheduledReminders,
  MAX_REMINDER_STAGES,
  type ReminderPlanItem,
} from "@/lib/bizbook-brain/reminder-engine";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  loadActiveSubscriptionReminderProviderCredentials,
  ReminderProviderError,
  sendEmailSubscriptionReminder,
  sendWhatsAppSubscriptionReminder,
} from "@/lib/supabase/reminder-providers";
import type { ActiveReminderCredentials } from "@/lib/supabase/notification-provider-credentials";

export const maxDuration = 60;

const PAGE_SIZE = 250;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15 * 60 * 1000;
type Channel = "Email" | "WhatsApp";
type ConcreteReminderPlanItem = Omit<ReminderPlanItem, "channel"> & { channel: Channel };
type Counts = { sent: number; skipped: number; failed: number; alreadyProcessed: number };

function authorized(request: Request): boolean {
  const expected = process.env.BIZBOOK_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeWhatsApp(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (/^\d{10}$/.test(digits)) return `91${digits}`;
  return /^91\d{10}$/.test(digits) ? digits : null;
}

function providerName(channel: Channel): string {
  return channel === "Email" ? "Resend" : "Meta WhatsApp Cloud API";
}

function parseSchedule(value: unknown): ReminderPlanItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REMINDER_STAGES) return null;
  const plan: ReminderPlanItem[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (row.reminder_number !== index + 1
      || typeof row.day_offset !== "number" || !Number.isInteger(row.day_offset) || row.day_offset < -30 || row.day_offset > 30
      || (row.channel !== "Email" && row.channel !== "WhatsApp" && row.channel !== "Both")
      || typeof row.send_time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.send_time)) return null;
    plan.push({ reminderNumber: index + 1, dayOffset: row.day_offset, channel: row.channel, sendTime: row.send_time });
  }
  return plan;
}

function dateLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone }).format(new Date(value));
}

async function skip(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  row: { id: string; institute_id: string },
  periodEnd: string,
  stage: ConcreteReminderPlanItem,
  policyVersion: number,
  idempotencyKey: string,
  code: string,
): Promise<boolean> {
  const { error } = await supabase.from("platform_subscription_reminder_logs").insert({
    institute_id: row.institute_id,
    subscription_id: row.id,
    reminder_period_end: periodEnd,
    reminder_number: stage.reminderNumber,
    schedule_version: policyVersion,
    channel: stage.channel,
    delivery_status: "Skipped",
    provider: providerName(stage.channel),
    idempotency_key: idempotencyKey,
    attempt_count: 0,
    retryable: false,
    last_error_code: code,
  });
  if (error?.code === "23505") return false;
  if (error) throw new Error("Could not record the subscription reminder skip.");
  return true;
}

async function claim(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    row: { id: string; institute_id: string };
    periodEnd: string;
    stage: ConcreteReminderPlanItem;
    policyVersion: number;
    idempotencyKey: string;
    recipient: string;
  },
): Promise<{ id: string; attemptCount: number } | null> {
  const base = {
    institute_id: input.row.institute_id,
    subscription_id: input.row.id,
    reminder_period_end: input.periodEnd,
    reminder_number: input.stage.reminderNumber,
    schedule_version: input.policyVersion,
    channel: input.stage.channel,
    delivery_status: "Processing" as const,
    provider: providerName(input.stage.channel),
    recipient_fingerprint: fingerprint(input.recipient),
    idempotency_key: input.idempotencyKey,
    attempt_count: 1,
    retryable: true,
    next_attempt_at: null,
    last_error_code: null,
    attempted_at: new Date().toISOString(),
  };
  const { data: inserted, error: insertError } = await supabase.from("platform_subscription_reminder_logs")
    .insert(base).select("id, attempt_count").maybeSingle();
  if (!insertError && inserted) return { id: inserted.id, attemptCount: inserted.attempt_count };
  if (insertError?.code !== "23505") throw new Error("Could not claim the subscription reminder.");

  const { data: previous, error: previousError } = await supabase.from("platform_subscription_reminder_logs")
    .select("id, delivery_status, attempt_count, retryable, next_attempt_at")
    .eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (previousError) throw new Error("Could not inspect the subscription reminder log.");
  if (!previous || previous.delivery_status !== "Failed" || !previous.retryable
    || previous.attempt_count >= MAX_ATTEMPTS
    || (previous.next_attempt_at && Date.parse(previous.next_attempt_at) > Date.now())) return null;

  const attemptCount = previous.attempt_count + 1;
  const { data: updated, error: updateError } = await supabase.from("platform_subscription_reminder_logs")
    .update({ delivery_status: "Processing", attempt_count: attemptCount, attempted_at: new Date().toISOString(), next_attempt_at: null, last_error_code: null })
    .eq("id", previous.id).eq("delivery_status", "Failed").eq("attempt_count", previous.attempt_count)
    .select("id, attempt_count").maybeSingle();
  if (updateError) throw new Error("Could not claim the subscription reminder retry.");
  return updated ? { id: updated.id, attemptCount: updated.attempt_count } : null;
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json({ success: false, message: "Subscription reminder database access is not configured." }, { status: 503 });
  }

  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try { supabase = createSupabaseAdminClient(); }
  catch { return NextResponse.json({ success: false, message: "Subscription reminder database access is not configured." }, { status: 503 }); }

  const counts: Counts = { sent: 0, skipped: 0, failed: 0, alreadyProcessed: 0 };
  const providerCache = new Map<Channel, ActiveReminderCredentials | null>();
  const runInstant = new Date();
  try {
    const { data: policy, error: policyError } = await supabase.from("platform_subscription_reminder_policy")
      .select("is_enabled, schedule, schedule_version").eq("id", true).maybeSingle();
    if (policyError || !policy) return NextResponse.json({ success: false, message: "BizBook subscription reminder settings are unavailable. Apply the subscription reminder migration first.", counts }, { status: 503 });
    if (!policy.is_enabled) return NextResponse.json({ success: true, enabled: false, message: "BizBook subscription reminders are paused.", counts });
    const plan = parseSchedule(policy.schedule);
    if (!plan) return NextResponse.json({ success: false, message: "The BizBook subscription reminder schedule is invalid. Review Company Admin settings.", counts }, { status: 503 });

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: subscriptions, error: subscriptionError } = await supabase.from("institute_subscriptions")
        .select("id, institute_id, plan_id, status, billing_cycle, trial_ends_at, current_period_end, free_access_enabled")
        .eq("free_access_enabled", false).in("status", ["trialing", "active", "past_due"])
        .order("updated_at", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      if (subscriptionError) throw new Error("Could not load coaching subscription dates.");
      if (!subscriptions?.length) break;

      const instituteIds = [...new Set(subscriptions.map((item) => item.institute_id))];
      const planIds = [...new Set(subscriptions.flatMap((item) => item.plan_id ? [item.plan_id] : []))];
      const [institutesResult, plansResult] = await Promise.all([
        supabase.from("coaching_institutes").select("id, business_name, owner_name, email, phone, whatsapp, time_zone").in("id", instituteIds),
        planIds.length
          ? supabase.from("platform_subscription_plans").select("id, name, monthly_price, annual_price").in("id", planIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (institutesResult.error || plansResult.error) throw new Error("Could not load coaching contacts or BizBook plan details.");
      const institutes = new Map((institutesResult.data ?? []).map((item) => [item.id, item]));
      const plans = new Map((plansResult.data ?? []).map((item) => [item.id, item]));

      for (const subscription of subscriptions) {
        if (subscription.free_access_enabled || !subscription.plan_id) continue;
        const periodEndAt = subscription.status === "trialing" ? subscription.trial_ends_at : subscription.current_period_end;
        if (!periodEndAt) continue;
        const institute = institutes.get(subscription.institute_id);
        const subscriptionPlan = plans.get(subscription.plan_id);
        if (!institute || !subscriptionPlan) continue;

        const periodEnd = getLocalDateInTimeZone(new Date(periodEndAt), institute.time_zone);
        const localDate = getLocalDateInTimeZone(runInstant, institute.time_zone);
        const localTime = getLocalTimeInTimeZone(runInstant, institute.time_zone);
        const scheduledStages = getScheduledReminders(periodEnd, localDate, institute.time_zone, plan);
        for (const scheduled of scheduledStages) {
          if (localTime < scheduled.sendTime) continue;
          const channels: Channel[] = scheduled.channel === "Both" ? ["Email", "WhatsApp"] : [scheduled.channel];
          for (const channel of channels) {
            const stage: ConcreteReminderPlanItem = { ...scheduled, channel };
            const key = `bizbook-subscription:${subscription.id}:${periodEnd}:stage:${stage.reminderNumber}:channel:${channel.toLowerCase()}`;
            const recipient = channel === "Email"
              ? (institute.email?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(institute.email.trim()) ? institute.email.trim() : null)
              : normalizeWhatsApp(institute.whatsapp ?? institute.phone);
            if (!recipient) {
              if (await skip(supabase, subscription, periodEnd, stage, policy.schedule_version, key, channel === "Email" ? "missing_coaching_email" : "missing_coaching_whatsapp")) counts.skipped += 1;
              else counts.alreadyProcessed += 1;
              continue;
            }

            if (!providerCache.has(channel)) {
              providerCache.set(channel, await loadActiveSubscriptionReminderProviderCredentials(supabase, channel));
            }
            const credentials = providerCache.get(channel);
            if (!credentials || credentials.channel !== channel) {
              if (await skip(supabase, subscription, periodEnd, stage, policy.schedule_version, key, channel === "WhatsApp" ? "subscription_template_or_provider_inactive" : "email_provider_inactive")) counts.skipped += 1;
              else counts.alreadyProcessed += 1;
              continue;
            }

            const attempt = await claim(supabase, {
              row: subscription,
              periodEnd,
              stage,
              policyVersion: policy.schedule_version,
              idempotencyKey: key,
              recipient,
            });
            if (!attempt) { counts.alreadyProcessed += 1; continue; }
            const amount = subscription.billing_cycle === "annual" ? subscriptionPlan.annual_price : subscriptionPlan.monthly_price;
            const input = {
              instituteName: institute.business_name,
              planName: subscriptionPlan.name,
              renewalDate: dateLabel(periodEndAt, institute.time_zone),
              amount: Number(amount),
            };

            try {
              const result = channel === "Email" && credentials.channel === "Email"
                ? await sendEmailSubscriptionReminder(recipient, input, credentials, key)
                : channel === "WhatsApp" && credentials.channel === "WhatsApp"
                  ? await sendWhatsAppSubscriptionReminder(recipient, input, credentials)
                  : null;
              if (!result) throw new ReminderProviderError("Provider channel mismatch.", "provider_channel_mismatch", false);
              const { error: updateError } = await supabase.from("platform_subscription_reminder_logs")
                .update({ delivery_status: "Sent", provider_message_reference: result.messageReference, retryable: false, next_attempt_at: null, sent_at: new Date().toISOString() })
                .eq("id", attempt.id).eq("delivery_status", "Processing");
              if (updateError) throw new Error("Could not record successful subscription reminder delivery.");
              counts.sent += 1;
            } catch (error) {
              const providerError = error instanceof ReminderProviderError ? error : null;
              const retryable = providerError?.retryable === true && attempt.attemptCount < MAX_ATTEMPTS;
              await supabase.from("platform_subscription_reminder_logs")
                .update({ delivery_status: providerError?.outcomeUnknown ? "Unknown" : "Failed", retryable, next_attempt_at: retryable ? new Date(Date.now() + RETRY_DELAY_MS).toISOString() : null, last_error_code: providerError?.code ?? "provider_request_failed" })
                .eq("id", attempt.id).eq("delivery_status", "Processing");
              counts.failed += 1;
            }
          }
        }
      }
      if (subscriptions.length < PAGE_SIZE) break;
    }
  } catch {
    return NextResponse.json({ success: false, message: "BizBook subscription reminder run could not be completed. Check server integration and database logs.", counts }, { status: 503 });
  }
  return NextResponse.json({ success: true, counts });
}
