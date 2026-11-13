"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellRing, CalendarClock, Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { useWorkspaceSubscription, type WorkspaceNotification } from "@/components/layout/WorkspaceSubscriptionContext";
import { effectiveSubscriptionStatus } from "@/lib/supabase/subscription-access";

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

export default function WorkspaceHeaderStatus() {
  const router = useRouter();
  const { institutes, selection } = useWorkspaceScope();
  const { instituteId, snapshot, loading, error, now, refresh } = useWorkspaceSubscription();
  const institute = useMemo(() => institutes.find((item) => item.id === selection?.instituteId) ?? null, [institutes, selection]);
  const [open, setOpen] = useState(false);
  const [savingRead, setSavingRead] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [dismissedSystemKeys, setDismissedSystemKeys] = useState<Set<string>>(() => new Set());

  const subscription = snapshot?.subscription ?? null;
  const endDate = subscription?.status === "trialing" ? subscription.trial_ends_at : subscription?.current_period_end;
  const endTimestamp = endDate ? Date.parse(endDate) : NaN;
  const effectiveStatus = subscription && now !== null
    ? effectiveSubscriptionStatus(subscription.status, endDate, now)
    : subscription?.status;
  const isComplimentary = subscription?.free_access_enabled === true;
  const isExpired = !isComplimentary && effectiveStatus === "expired";
  const remaining = now !== null && Number.isFinite(endTimestamp)
    ? Math.max(0, Math.ceil((endTimestamp - now) / 86_400_000))
    : null;

  const systemNotification = useMemo<WorkspaceNotification | null>(() => {
    if (!instituteId || !subscription || subscription.free_access_enabled || now === null || !endDate || !Number.isFinite(endTimestamp)) return null;
    const isTrial = subscription.status === "trialing";
    const isRenewalNotice = effectiveStatus === "expired" || effectiveStatus === "past_due" || effectiveStatus === "suspended";
    if (!isRenewalNotice && !isTrial) return null;
    const key = `system:subscription:${instituteId}:${isTrial ? "trial" : "plan"}:${isRenewalNotice ? "expired" : "active"}:${isTrial ? remaining ?? "unknown" : ""}`;
    const trialMessage = remaining === null
      ? "Your institute is on a free trial. The end date is not available yet; contact your institute owner."
      : `Your institute is on a free trial with ${remaining} day${remaining === 1 ? "" : "s"} left. Choose a plan before it ends to keep your workspace available.`;
    return {
      key,
      kind: "subscription",
      title: isRenewalNotice ? (isTrial ? "Free trial ended" : "Subscription needs attention") : "Free trial active",
      message: isRenewalNotice
        ? (isTrial ? "Your free trial has ended. Choose a plan to restore access to your workspace." : "Your subscription term has ended. Renew or choose a plan to restore workspace access.")
        : isTrial ? trialMessage : `Your plan is active through ${dateLabel(endDate)}.`,
      created_at: endDate,
      is_read: dismissedSystemKeys.has(key),
    };
  }, [dismissedSystemKeys, endDate, endTimestamp, effectiveStatus, instituteId, now, remaining, subscription]);

  const notifications = useMemo(() => {
    const items = snapshot?.notifications ?? [];
    const cleanItems = items
      .filter((item) => !(item.kind === "subscription" && /trial started/i.test(item.title)))
      .map((item) => item.kind === "subscription" && /invoice is ready in Subscription/i.test(item.message)
        ? { ...item, message: "Your plan purchase is ready. Open Plans & Subscription to continue secure checkout." }
        : item);
    return systemNotification ? [...cleanItems, systemNotification].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)) : cleanItems;
  }, [snapshot?.notifications, systemNotification]);
  const unread = notifications.filter((item) => !item.is_read);

  async function markRead(keys: string[]) {
    if (!instituteId || !keys.length || savingRead) return;
    const systemKeys = keys.filter((key) => key.startsWith("system:"));
    if (systemKeys.length) setDismissedSystemKeys((current) => new Set([...current, ...systemKeys]));
    const persistedKeys = keys.filter((key) => !key.startsWith("system:"));
    if (!persistedKeys.length) return;
    setSavingRead(true);
    setUpdateError("");
    try {
      const response = await fetch("/api/workspace/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instituteId, keys: persistedKeys }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Notification status could not be saved.");
      refresh();
    } catch (cause) {
      setUpdateError(cause instanceof Error ? cause.message : "Notification status could not be saved.");
    } finally {
      setSavingRead(false);
    }
  }

  const label = loading ? "Checking plan"
    : !snapshot ? "Plan status unavailable"
      : !subscription ? "Choose a plan"
        : isComplimentary ? "Complimentary access"
        : effectiveStatus === "expired" ? "Plan expired"
          : effectiveStatus === "trialing" ? "Free trial"
            : effectiveStatus === "active" ? `${subscription.plan_name || "Plan"} · Active`
              : effectiveStatus === "cancelled" ? `${subscription.plan_name || "Plan"} · Paid through`
                : effectiveStatus === "past_due" ? subscription.pending_plan_name ? "Plan payment pending" : "Payment due"
                  : effectiveStatus?.replaceAll("_", " ") ?? "Plan status unavailable";
  const detail = loading ? "Checking saved account details"
    : !snapshot ? error || "Retry to check access"
      : !subscription ? "Choose a plan to continue"
        : isComplimentary ? "Provided by BizBook"
        : endDate && Number.isFinite(endTimestamp)
          ? effectiveStatus === "trialing" && remaining !== null && !isExpired
            ? `${remaining} day${remaining === 1 ? "" : "s"} left · ends ${dateLabel(endDate)}`
            : `${remaining !== null && !isExpired ? `${remaining} day${remaining === 1 ? "" : "s"} left · ` : ""}${isExpired ? "Ended" : "Renews"} ${dateLabel(endDate)}`
        : effectiveStatus === "past_due" ? subscription.pending_plan_name ? `Complete checkout for ${subscription.pending_plan_name}` : "Waiting for verified payment" : "Plan dates are not recorded";
  const tone = isComplimentary || effectiveStatus === "active" || effectiveStatus === "cancelled" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : effectiveStatus === "trialing" ? "border-blue-200 bg-blue-50 text-blue-900"
      : effectiveStatus === "past_due" || effectiveStatus === "expired" || effectiveStatus === "suspended" || !subscription ? "border-rose-200 bg-rose-50 text-rose-900"
        : "border-slate-200 bg-white text-slate-700";

  if (!institute) return null;

  return <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
    <Link href="/settings/subscription" title={`${label}. ${detail} Manage plan.`} aria-label={`${label}. ${detail}. Manage plan.`} className={`inline-flex min-h-10 max-w-[168px] items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[9px] font-extrabold sm:max-w-[240px] sm:px-3 sm:text-[11px] ${tone}`}>
      <CalendarClock size={14} className="shrink-0" /><span className="min-w-0"><span className="block truncate">{label}</span><span className="block truncate text-[8px] font-semibold opacity-80 sm:text-[9px]">{detail}</span></span>
    </Link>
    <div className="relative">
      <button type="button" aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="relative grid size-10 place-items-center rounded-xl border border-amber-200 bg-white text-amber-600 shadow-sm transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
        {unread.length ? <BellRing size={18} /> : <Bell size={18} />}{unread.length > 0 && <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-rose-600 text-[9px] font-extrabold text-white ring-2 ring-white">{unread.length > 9 ? "9+" : unread.length}</span>}
      </button>
      {open && <section className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(92vw,390px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_-28px_rgba(15,23,42,0.4)]" aria-label="Notifications">
        <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"><span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-700"><BellRing size={17} /></span><div className="min-w-0 flex-1"><h2 className="text-sm font-extrabold text-slate-950">Updates</h2><p className="text-[11px] text-slate-500">{unread.length ? `${unread.length} new for ${institute.name}` : `For ${institute.name}`}</p></div>{unread.length > 0 && <button type="button" onClick={() => void markRead(unread.map((item) => item.key))} disabled={savingRead} className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 disabled:opacity-50"><Check size={12} />Read all</button>}<button type="button" aria-label="Close notifications" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={15} /></button></header>
        {(updateError || error) && <p role="alert" className="flex items-center gap-2 border-b border-rose-100 bg-rose-50 px-4 py-2 text-[11px] text-rose-800"><CircleAlert size={13} />{updateError || error}</p>}
        <div className="max-h-[min(65vh,430px)] overflow-y-auto p-2">{loading && <div role="status" className="flex items-center justify-center gap-2 p-7 text-xs text-slate-500"><LoaderCircle size={15} className="animate-spin" />Loading updates…</div>}
          {!loading && notifications.length === 0 && <div className="p-7 text-center"><span className="mx-auto grid size-10 place-items-center rounded-xl bg-slate-50 text-slate-400"><Bell size={18} /></span><p className="mt-3 text-xs font-bold text-slate-700">You’re all caught up</p><p className="mt-1 text-[11px] leading-5 text-slate-500">BizBook announcements and subscription changes will appear here.</p></div>}
          {notifications.map((item) => <button type="button" key={item.key} onClick={() => { if (!item.is_read) void markRead([item.key]); setOpen(false); if (item.kind === "subscription") router.push("/settings/subscription"); }} className={`block w-full rounded-xl px-3 py-3 text-left transition hover:bg-slate-50 ${!item.is_read ? "bg-blue-50/70" : ""}`}><div className="flex items-start gap-2.5"><span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${item.kind === "announcement" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}><BellRing size={14} /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate text-xs text-slate-900">{item.title}</strong>{!item.is_read && <span className="size-2 shrink-0 rounded-full bg-rose-600" />}</span><span className="mt-1 block whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-600">{item.message}</span><span className="mt-1 block text-[10px] text-slate-400">{item.kind === "announcement" ? "BizBook update" : "Subscription"} · {dateLabel(item.created_at)}{item.kind === "subscription" && <span className="ml-2 font-extrabold text-violet-700">GO →</span>}</span></span></div></button>)}
        </div><footer className="border-t border-slate-100 px-4 py-2"><Link href="/settings/subscription" onClick={() => setOpen(false)} className="text-[11px] font-bold text-blue-800 hover:underline">View plans and subscription</Link></footer>
      </section>}
    </div>
  </div>;
}
