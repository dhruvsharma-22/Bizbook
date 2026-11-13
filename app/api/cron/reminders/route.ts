import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getLocalDateInTimeZone,
  getLocalTimeInTimeZone,
  getScheduledReminders,
  hasReminderConsent,
  MAX_REMINDER_STAGES,
  type ReminderPlanItem,
} from "@/lib/bizbook-brain/reminder-engine";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  loadActiveReminderProviderCredentials,
  ReminderProviderError,
  sendEmailReminder,
  sendWhatsAppReminder,
  type ReminderProviderInput,
} from "@/lib/supabase/reminder-providers";
import type { ActiveReminderCredentials } from "@/lib/supabase/notification-provider-credentials";

export const maxDuration = 60;

const PAGE_SIZE = 500;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15 * 60 * 1000;

type CandidateCounts = {
  sent: number;
  skipped: number;
  failed: number;
  alreadyProcessed: number;
};

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

function whatsappAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (/^\d{10}$/.test(digits)) return `91${digits}`;
  if (/^91\d{10}$/.test(digits)) return digits;
  return null;
}

function reminderKey(installmentId: string, stage: number, version: number, channel: "Email" | "WhatsApp"): string {
  return `installment:${installmentId}:stage:${stage}:version:${version}:channel:${channel.toLowerCase()}`;
}

function parseReminderPlan(value: unknown): ReminderPlanItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REMINDER_STAGES) return null;
  const plan: ReminderPlanItem[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const stage = item as Record<string, unknown>;
    if (stage.reminder_number !== index + 1
      || typeof stage.day_offset !== "number" || !Number.isInteger(stage.day_offset) || stage.day_offset < -30 || stage.day_offset > 30
      || (stage.channel !== "Email" && stage.channel !== "WhatsApp" && stage.channel !== "Both")
      || typeof stage.send_time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(stage.send_time)) return null;
    plan.push({ reminderNumber: index + 1, dayOffset: stage.day_offset, channel: stage.channel, sendTime: stage.send_time });
  }
  return plan;
}

function providerName(channel: "Email" | "WhatsApp"): string {
  return channel === "Email" ? "Resend" : "Meta WhatsApp Cloud API";
}

async function createSkippedLog(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    instituteId: string;
    branchId: string | null;
    installmentId: string;
    channel: "Email" | "WhatsApp";
    stage: number;
    version: number;
    dueDate: string;
    idempotencyKey: string;
    errorCode: string;
  },
): Promise<boolean> {
  const { error } = await supabase.from("notification_logs").insert({
    institute_id: input.instituteId,
    branch_id: input.branchId,
    channel: input.channel,
    event_type: "installment_reminder",
    delivery_status: "Skipped",
    provider: providerName(input.channel),
    reminder_installment_id: input.installmentId,
    reminder_number: input.stage,
    reminder_schedule_version: input.version,
    reminder_due_date: input.dueDate,
    idempotency_key: input.idempotencyKey,
    attempt_count: 0,
    retryable: false,
    last_error_code: input.errorCode,
  });
  if (error?.code === "23505") return false;
  if (error) throw new Error("Could not save the reminder delivery log.");
  return true;
}

async function claimReminderAttempt(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    instituteId: string;
    branchId: string | null;
    installmentId: string;
    channel: "Email" | "WhatsApp";
    stage: number;
    version: number;
    dueDate: string;
    idempotencyKey: string;
    recipient: string;
  },
): Promise<{ id: string; attemptCount: number } | null> {
  const now = new Date().toISOString();
  const base = {
    institute_id: input.instituteId,
    branch_id: input.branchId,
    channel: input.channel,
    event_type: "installment_reminder",
    delivery_status: "Processing" as const,
    provider: providerName(input.channel),
    recipient_fingerprint: fingerprint(input.recipient),
    reminder_installment_id: input.installmentId,
    reminder_number: input.stage,
    reminder_schedule_version: input.version,
    reminder_due_date: input.dueDate,
    idempotency_key: input.idempotencyKey,
    attempt_count: 1,
    retryable: true,
    attempted_at: now,
    next_attempt_at: null,
    last_error_code: null,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("notification_logs")
    .insert(base)
    .select("id, attempt_count")
    .maybeSingle();

  if (!insertError && inserted) {
    return { id: inserted.id, attemptCount: inserted.attempt_count };
  }
  if (insertError?.code !== "23505") {
    throw new Error("Could not claim the reminder delivery attempt.");
  }

  const { data: previous, error: previousError } = await supabase
    .from("notification_logs")
    .select("id, delivery_status, attempt_count, retryable, next_attempt_at")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (previousError) throw new Error("Could not inspect the reminder delivery log.");
  if (
    !previous ||
    previous.delivery_status !== "Failed" ||
    !previous.retryable ||
    previous.attempt_count >= MAX_ATTEMPTS ||
    (previous.next_attempt_at && Date.parse(previous.next_attempt_at) > Date.now())
  ) {
    return null;
  }

  const attemptCount = previous.attempt_count + 1;
  const { data: claimed, error: claimError } = await supabase
    .from("notification_logs")
    .update({
      delivery_status: "Processing",
      attempt_count: attemptCount,
      attempted_at: now,
      next_attempt_at: null,
      last_error_code: null,
    })
    .eq("id", previous.id)
    .eq("delivery_status", "Failed")
    .eq("retryable", true)
    .lt("attempt_count", MAX_ATTEMPTS)
    .select("id, attempt_count")
    .maybeSingle();
  if (claimError) throw new Error("Could not claim the reminder retry.");
  return claimed ? { id: claimed.id, attemptCount: claimed.attempt_count } : null;
}

async function finishAttempt(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  logId: string,
  update: {
    delivery_status: "Sent" | "Failed" | "Unknown";
    provider_message_reference?: string | null;
    retryable?: boolean;
    next_attempt_at?: string | null;
    last_error_code?: string | null;
    sent_at?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("notification_logs")
    .update(update)
    .eq("id", logId)
    .eq("delivery_status", "Processing");
  if (error) throw new Error("Could not finalize the reminder delivery log.");
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json({ success: false, message: "Reminder database access is not configured." }, { status: 503 });
  }

  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ success: false, message: "Reminder database access is not configured." }, { status: 503 });
  }

  const counts: CandidateCounts = { sent: 0, skipped: 0, failed: 0, alreadyProcessed: 0 };
  const providerCredentialsByChannel = new Map<"Email" | "WhatsApp", ActiveReminderCredentials | null>();
  const runInstant = new Date();
  try {
    const { data: reminderPolicy, error: policyError } = await supabase
      .from("platform_reminder_policy")
      .select("is_enabled, schedule")
      .eq("id", true)
      .maybeSingle();
    if (policyError || !reminderPolicy) {
      return NextResponse.json({ success: false, message: "Reminder policy is unavailable. Apply the platform reminder schedule migration first.", counts }, { status: 503 });
    }
    if (!reminderPolicy.is_enabled) {
      return NextResponse.json({ success: true, enabled: false, message: "The platform reminder schedule is disabled.", counts });
    }
    const reminderPlan = parseReminderPlan(reminderPolicy.schedule);
    if (!reminderPlan) {
      return NextResponse.json({ success: false, message: "The saved reminder schedule is invalid. Review it in Company Admin.", counts }, { status: 503 });
    }

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: balances, error: balanceError } = await supabase
        .from("installment_balances")
        .select("installment_id, institute_id, branch_id, student_id, sequence_number, due_date, outstanding_amount, balance_status")
        .gt("outstanding_amount", 0)
        .neq("balance_status", "Cancelled")
        .not("due_date", "is", null)
        .order("due_date", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (balanceError) throw new Error("Could not load outstanding installments.");
      if (!balances?.length) break;

      const installmentIds = [...new Set(balances.map((row) => row.installment_id))];
      const studentIds = [...new Set(balances.map((row) => row.student_id))];
      const instituteIds = [...new Set(balances.map((row) => row.institute_id))];
      const branchIds = [...new Set(balances.flatMap((row) => row.branch_id ? [row.branch_id] : []))];
      const [installmentsResult, studentsResult, institutesResult] = await Promise.all([
        supabase.from("student_installments")
          .select("id, institute_id, student_id, due_date, reminder_schedule_version")
          .in("id", installmentIds),
        supabase.from("students")
          .select("id, institute_id, name, parent_email, parent_email_opt_in, whatsapp_opt_in, parent_mobile, whatsapp, archived_at")
          .in("id", studentIds)
          .is("archived_at", null),
        supabase.from("coaching_institutes")
          .select("id, business_name, time_zone")
          .in("id", instituteIds),
      ]);
      if (installmentsResult.error || studentsResult.error || institutesResult.error) {
        throw new Error("Could not load reminder contacts or schedules.");
      }
      const activeBranchIds = new Set<string>();
      if (branchIds.length) {
        const { data: branches, error: branchError } = await supabase
          .from("branches")
          .select("id, is_active")
          .in("id", branchIds);
        if (branchError) throw new Error("Could not verify reminder branch status.");
        for (const branch of branches ?? []) {
          if (branch.is_active) activeBranchIds.add(branch.id);
        }
      }

      const installmentMap = new Map((installmentsResult.data ?? []).map((row) => [`${row.institute_id}:${row.id}`, row]));
      const studentMap = new Map((studentsResult.data ?? []).map((row) => [`${row.institute_id}:${row.id}`, row]));
      const instituteMap = new Map((institutesResult.data ?? []).map((row) => [row.id, row]));

      for (const balance of balances) {
        if (!balance.due_date || balance.outstanding_amount <= 0) continue;
        if (balance.branch_id && !activeBranchIds.has(balance.branch_id)) continue;
        const installment = installmentMap.get(`${balance.institute_id}:${balance.installment_id}`);
        const student = studentMap.get(`${balance.institute_id}:${balance.student_id}`);
        const institute = instituteMap.get(balance.institute_id);
        if (!installment || !student || !institute) continue;

        const [currentInstallmentResult, currentBalanceResult] = await Promise.all([
          supabase.from("student_installments")
            .select("id, institute_id, student_id, sequence_number, due_date, status, reminder_schedule_version")
            .eq("id", installment.id)
            .eq("institute_id", balance.institute_id)
            .maybeSingle(),
          supabase.from("installment_balances")
            .select("outstanding_amount, balance_status")
            .eq("installment_id", installment.id)
            .maybeSingle(),
        ]);
        if (currentInstallmentResult.error || currentBalanceResult.error) {
          throw new Error("Could not recheck the current installment balance.");
        }
        const currentInstallment = currentInstallmentResult.data;
        const currentBalance = currentBalanceResult.data;
        if (
          !currentInstallment ||
          !currentBalance ||
          currentInstallment.status === "Paid" ||
          currentInstallment.status === "Cancelled" ||
          currentBalance.balance_status === "Paid" ||
          currentBalance.balance_status === "Cancelled" ||
          currentBalance.outstanding_amount <= 0 ||
          !currentInstallment.due_date
        ) continue;

        const instituteDate = getLocalDateInTimeZone(runInstant, institute.time_zone);
        const instituteTime = getLocalTimeInTimeZone(runInstant, institute.time_zone);
        const version = currentInstallment.reminder_schedule_version;
        const dueStages = getScheduledReminders(currentInstallment.due_date, instituteDate, institute.time_zone, reminderPlan);
        for (const scheduled of dueStages) {
          if (instituteTime < scheduled.sendTime) continue;
          const channels: Array<"Email" | "WhatsApp"> = scheduled.channel === "Both"
            ? ["Email", "WhatsApp"]
            : [scheduled.channel];
          for (const channel of channels) {
            const idempotencyKey = reminderKey(installment.id, scheduled.reminderNumber, version, channel);
        if (!hasReminderConsent(channel, {
          emailOptIn: student.parent_email_opt_in,
          whatsappOptIn: student.whatsapp_opt_in,
        })) {
          const skipped = await createSkippedLog(supabase, {
            instituteId: balance.institute_id,
            branchId: balance.branch_id,
            installmentId: installment.id,
            channel,
            stage: scheduled.reminderNumber,
            version,
            dueDate: currentInstallment.due_date,
            idempotencyKey,
            errorCode: channel === "Email" ? "email_not_opted_in" : "whatsapp_not_opted_in",
          });
          if (skipped) counts.skipped += 1;
          else counts.alreadyProcessed += 1;
          continue;
        }
        const rawAddress = channel === "Email"
          ? student.parent_email?.trim() ?? ""
          : whatsappAddress(student.whatsapp ?? student.parent_mobile);
        const recipient = channel === "Email"
          ? (typeof rawAddress === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawAddress) ? rawAddress : null)
          : rawAddress;

        if (!recipient) {
          const skipped = await createSkippedLog(supabase, {
            instituteId: balance.institute_id,
            branchId: balance.branch_id,
            installmentId: installment.id,
            channel,
            stage: scheduled.reminderNumber,
            version,
            dueDate: currentInstallment.due_date,
            idempotencyKey,
            errorCode: channel === "Email" ? "missing_parent_email" : "missing_whatsapp_number",
          });
          if (skipped) counts.skipped += 1;
          else counts.alreadyProcessed += 1;
          continue;
        }

        if (!providerCredentialsByChannel.has(channel)) {
          providerCredentialsByChannel.set(
            channel,
            await loadActiveReminderProviderCredentials(supabase, channel),
          );
        }
        const providerCredentials = providerCredentialsByChannel.get(channel);
        if (!providerCredentials) {
          const skipped = await createSkippedLog(supabase, {
            instituteId: balance.institute_id,
            branchId: balance.branch_id,
            installmentId: installment.id,
            channel,
            stage: scheduled.reminderNumber,
            version,
            dueDate: currentInstallment.due_date,
            idempotencyKey,
            errorCode: "provider_inactive",
          });
          if (skipped) counts.skipped += 1;
          else counts.alreadyProcessed += 1;
          continue;
        }

        const attempt = await claimReminderAttempt(supabase, {
          instituteId: balance.institute_id,
          branchId: balance.branch_id,
          installmentId: installment.id,
          channel,
          stage: scheduled.reminderNumber,
          version,
          dueDate: currentInstallment.due_date,
          idempotencyKey,
          recipient,
        });
        if (!attempt) {
          counts.alreadyProcessed += 1;
          continue;
        }

        const providerInput: ReminderProviderInput = {
          idempotencyKey,
          studentName: student.name,
          instituteName: institute.business_name,
          installmentNumber: currentInstallment.sequence_number,
          dueDate: currentInstallment.due_date,
          outstanding: currentBalance.outstanding_amount,
        };

        try {
          let messageReference: string;
          if (channel === "Email" && providerCredentials.channel === "Email") {
            const result = await sendEmailReminder(recipient, providerInput, providerCredentials);
            messageReference = result.messageReference;
          } else if (channel === "WhatsApp" && providerCredentials.channel === "WhatsApp") {
            const result = await sendWhatsAppReminder(recipient, providerInput, providerCredentials);
            messageReference = result.messageReference;
          } else {
            throw new ReminderProviderError(
              "The active provider configuration does not match the reminder channel.",
              "provider_channel_mismatch",
              false,
            );
          }
          await finishAttempt(supabase, attempt.id, {
            delivery_status: "Sent",
            provider_message_reference: messageReference,
            retryable: false,
            next_attempt_at: null,
            sent_at: new Date().toISOString(),
          });
          counts.sent += 1;
        } catch (error) {
          const providerError = error instanceof ReminderProviderError ? error : null;
          const retryable = providerError?.retryable === true && attempt.attemptCount < MAX_ATTEMPTS;
          await finishAttempt(supabase, attempt.id, {
            delivery_status: providerError?.outcomeUnknown ? "Unknown" : "Failed",
            retryable,
            next_attempt_at: retryable ? new Date(Date.now() + RETRY_DELAY_MS).toISOString() : null,
            last_error_code: providerError?.code ?? "provider_request_failed",
          });
          counts.failed += 1;
        }
          }
        }
      }

      if (balances.length < PAGE_SIZE) break;
    }
  } catch {
    return NextResponse.json({
      success: false,
      message: "The reminder run could not be completed. Check server-side integration configuration and database logs.",
      counts,
    }, { status: 503 });
  }

  return NextResponse.json({ success: true, counts });
}
