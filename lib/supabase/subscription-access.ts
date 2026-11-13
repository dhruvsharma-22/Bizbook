import type { WorkspaceInstitute } from "@/lib/supabase/workspace-scope";

/** Keep the screen's permission gate aligned with can_manage_institute(). */
export function canManageInstituteBilling(
  institute: Pick<WorkspaceInstitute, "role" | "accessScope"> | null | undefined,
): boolean {
  return Boolean(
    institute &&
      institute.accessScope === "institute" &&
      (institute.role === "owner" || institute.role === "administrator"),
  );
}

export function formatSubscriptionDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function subscriptionStatusTone(status: string): "green" | "amber" | "red" | "slate" {
  switch (status) {
    case "active":
      return "green";
    case "trialing":
    case "past_due":
      return "amber";
    case "suspended":
    case "cancelled":
    case "expired":
      return "red";
    default:
      return "slate";
  }
}

/** Derive expiry from the saved end timestamp; never invent a duration. */
export function effectiveSubscriptionStatus(status: string, periodEnd: string | null | undefined, now: number): string {
  if (!["active", "trialing", "cancelled"].includes(status) || !periodEnd) return status;
  const expiresAt = Date.parse(periodEnd);
  return Number.isFinite(expiresAt) && expiresAt <= now ? "expired" : status;
}

export type WorkspaceSubscriptionAccess = {
  status: string;
  plan_name: string | null;
  free_access_enabled?: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
};

/** UI access decision from database-saved dates; demos always require an explicit end date. */
export function canOpenWorkspaceForSubscription(
  subscription: WorkspaceSubscriptionAccess | null | undefined,
  now: number,
): boolean {
  if (!subscription) return false;
  if (subscription.free_access_enabled) return true;
  if (subscription.status === "trialing") {
    const end = Date.parse(subscription.trial_ends_at ?? "");
    return Number.isFinite(end) && end > now;
  }
  if (subscription.status === "active") {
    if (!subscription.current_period_end) return true;
    const end = Date.parse(subscription.current_period_end);
    return Number.isFinite(end) && end > now;
  }
  if (subscription.status === "cancelled") {
    const end = Date.parse(subscription.current_period_end ?? "");
    return Number.isFinite(end) && end > now;
  }
  if (subscription.status === "past_due") {
    const graceEnd = Date.parse(subscription.grace_period_ends_at ?? subscription.current_period_end ?? "");
    return Number.isFinite(graceEnd) && graceEnd > now;
  }
  return false;
}

export const subscriptionStatusLabels: Record<string, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  suspended: "Suspended",
  cancelled: "Cancelled",
  expired: "Expired",
};
