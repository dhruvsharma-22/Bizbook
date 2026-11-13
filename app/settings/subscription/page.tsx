"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  BadgeCheck,
  CalendarClock,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { useWorkspaceSubscription } from "@/components/layout/WorkspaceSubscriptionContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAuthorizedTestProjectConfigured } from "@/lib/supabase/workspace-scope";
import {
  canManageInstituteBilling,
  effectiveSubscriptionStatus,
  formatSubscriptionDate,
  subscriptionStatusLabels,
  subscriptionStatusTone,
} from "@/lib/supabase/subscription-access";

type SubscriptionRow = {
  id: string;
  plan_id: string | null;
  pending_plan_id: string | null;
  pending_billing_cycle: string | null;
  status: string;
  billing_cycle: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
};

type PlanRow = {
  name: string;
  description: string | null;
  monthly_price: number;
  annual_price: number;
  monthly_duration_days: number;
  annual_duration_days: number;
  student_limit: number | null;
  staff_limit: number | null;
  branch_limit: number | null;
  features: unknown;
};

type PendingPayment = {
  id: string;
  amount: number;
  status: string;
  attempt: {
    id: string;
    provider: string;
    provider_order_id: string | null;
    status: string;
  } | null;
};

type SubscriptionSnapshot = {
  subscription: SubscriptionRow | null;
  plan: PlanRow | null;
  pendingPayment: PendingPayment | null;
};

type PlanOffer = {
  id: string;
  name: string;
  description: string | null;
  monthly_price: number;
  annual_price: number;
  monthly_compare_at_price: number | null;
  annual_compare_at_price: number | null;
  monthly_duration_days: number;
  annual_duration_days: number;
  can_purchase: boolean;
  availability_status: "upcoming" | "available" | "expired";
  features?: unknown;
  student_limit?: number | null;
  staff_limit?: number | null;
  branch_limit?: number | null;
  is_recommended?: boolean;
};

type SubscriptionViewState = { instituteId: string; loading: boolean; error: string; snapshot: SubscriptionSnapshot | null };

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const statusClasses = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-rose-200 bg-rose-50 text-rose-800",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
} as const;
const cardClass = "rounded-2xl border border-slate-200 bg-white shadow-sm";

function statusLabel(status: string): string {
  return subscriptionStatusLabels[status] ?? status.replaceAll("_", " ");
}

function safePlanFeatures(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function planLimit(value: number | null | undefined): string {
  if (value === null) return "Unlimited";
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-IN") : "Not listed";
}

export default function SubscriptionSettingsPage() {
  const router = useRouter();
  const { institutes, selection, loading: scopeLoading, error: scopeError, refresh: refreshScope } = useWorkspaceScope();
  const { instituteId: statusInstituteId, snapshot: workspaceStatus, now: statusNow, refresh: refreshHeaderSubscription } = useWorkspaceSubscription();
  const institute = institutes.find((item) => item.id === selection?.instituteId) ?? null;
  const canView = canManageInstituteBilling(institute);
  const [viewState, setViewState] = useState<SubscriptionViewState | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [offers, setOffers] = useState<PlanOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [clockNow, setClockNow] = useState<number | null>(null);
  const currentView = viewState?.instituteId === institute?.id ? viewState : null;
  const loading = Boolean(!scopeLoading && !scopeError && selection && institute && canView && (!currentView || currentView.loading));
  const error = currentView?.error ?? "";
  const snapshot = currentView?.snapshot ?? null;
  const complimentaryAccess = statusInstituteId === institute?.id && workspaceStatus?.subscription?.free_access_enabled === true;
  const effectiveNow = clockNow ?? statusNow;

  useEffect(() => {
    const tick = () => setClockNow(Date.now());
    void Promise.resolve().then(tick);
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      setOffersLoading(true);
      setOffersError("");
      try {
        const response = await fetch("/api/plans", { cache: "no-store" });
        const result = await response.json() as { plans?: unknown; error?: string };
        if (!response.ok || !Array.isArray(result.plans)) throw new Error(result.error || "Available plans could not be loaded.");
        const items = result.plans.filter((value): value is PlanOffer => Boolean(
          value && typeof value === "object" && typeof (value as PlanOffer).id === "string" && typeof (value as PlanOffer).name === "string",
        ));
        if (active) {
          setOffers(items);
          setSelectedPlanId((current) => current && items.some((item) => item.id === current)
            ? current : items.find((item) => item.is_recommended)?.id ?? items[0]?.id ?? "");
        }
      } catch (cause) {
        if (active) {
          setOffers([]);
          setOffersError(cause instanceof Error ? cause.message : "Available plans could not be loaded.");
        }
      } finally {
        if (active) setOffersLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const load = useCallback(async (instituteId: string): Promise<SubscriptionSnapshot> => {
    const supabase = createSupabaseBrowserClient();
    const { data: subscription, error: subscriptionError } = await supabase
      .from("institute_subscriptions")
      .select("id, plan_id, pending_plan_id, pending_billing_cycle, status, billing_cycle, trial_ends_at, current_period_start, current_period_end, grace_period_ends_at")
      .eq("institute_id", instituteId)
      .maybeSingle();
    if (subscriptionError) throw new Error("Subscription details could not be loaded.");

    let plan: PlanRow | null = null;
    if (subscription?.plan_id) {
      const { data, error: planError } = await supabase
        .from("platform_subscription_plans")
        .select("name, description, monthly_price, annual_price, monthly_duration_days, annual_duration_days, student_limit, staff_limit, branch_limit, features")
        .eq("id", subscription.plan_id)
        .maybeSingle();
      if (planError) throw new Error("Current plan details could not be loaded.");
      plan = data;
    }

    const { data: payment, error: paymentError } = await supabase
      .from("platform_subscription_invoices")
      .select("id, invoice_number, amount, status")
      .eq("institute_id", instituteId)
      .not("subscription_id", "is", null)
      .in("status", ["open", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (paymentError) throw new Error("Pending subscription payment could not be loaded.");

    let attempt: PendingPayment["attempt"] = null;
    if (payment) {
      const { data, error: attemptError } = await supabase
        .from("platform_payment_attempts")
        .select("id, provider, provider_order_id, status")
        .eq("institute_id", instituteId)
        .eq("invoice_id", payment.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (attemptError) throw new Error("Payment status could not be loaded.");
      attempt = data;
    }

    return {
      subscription: subscription as SubscriptionRow | null,
      plan,
      pendingPayment: payment ? { ...payment, amount: Number(payment.amount), attempt } : null,
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (scopeLoading || scopeError || !selection || !institute || !canView) return () => { active = false; };
    const instituteId = institute.id;
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!isAuthorizedTestProjectConfigured()) {
        setViewState({ instituteId, loading: false, error: "Subscription management is connected only to the authorized test project.", snapshot: null });
        return;
      }
      setViewState({ instituteId, loading: true, error: "", snapshot: null });
      try {
        const data = await load(instituteId);
        if (active) {
          setViewState({ instituteId, loading: false, error: "", snapshot: data });
          if (data.pendingPayment && data.subscription) {
            setBillingCycle(data.subscription.pending_billing_cycle === "annual" ? "annual" : "monthly");
          }
        }
      } catch (cause) {
        if (active) setViewState({ instituteId, loading: false, error: cause instanceof Error ? cause.message : "Subscription details could not be loaded.", snapshot: null });
      }
    });
    return () => { active = false; };
  }, [canView, institute, load, refreshKey, scopeError, scopeLoading, selection]);

  const retry = () => {
    setRefreshKey((value) => value + 1);
    refreshHeaderSubscription();
  };

  async function purchaseSelectedPlan(planId = selectedPlanId, cycle = billingCycle) {
    if (!institute || !planId || purchaseBusy || snapshot?.pendingPayment) return;
    setPurchaseBusy(true);
    setPurchaseMessage(null);
    try {
      const response = await fetch("/api/subscriptions/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instituteId: institute.id, planId, billingCycle: cycle }),
      });
      const result = await response.json() as { result?: unknown; error?: string };
      if (!response.ok) throw new Error((result.error || "The plan purchase could not be prepared.").replace(/invoice/gi, "pending payment"));
      const purchase = result.result && typeof result.result === "object" && !Array.isArray(result.result)
        ? result.result as Record<string, unknown> : null;
      const invoiceId = typeof purchase?.invoice_id === "string" ? purchase.invoice_id : "";
      if (!invoiceId) throw new Error("The server did not return a payment reference. Refresh your plan details and try again.");
      router.push(`/settings/subscription/checkout/${encodeURIComponent(invoiceId)}`);
    } catch (cause) {
      setPurchaseMessage({ kind: "error", text: cause instanceof Error ? cause.message : "The plan purchase could not be prepared." });
    } finally {
      setPurchaseBusy(false);
    }
  }

  async function cancelUnstartedInvoice() {
    const invoice = snapshot?.pendingPayment;
    if (!invoice || invoice.attempt || cancelBusy) return;
    if (!window.confirm("Cancel this unstarted plan request? No payment has been initiated. You can then choose another plan or billing period.")) return;
    setCancelBusy(true);
    setPurchaseMessage(null);
    try {
      const response = await fetch("/api/subscriptions/invoice/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The unstarted plan request could not be cancelled.");
      setPurchaseMessage({ kind: "success", text: "Unstarted payment request cancelled. You can now choose any available plan and billing period." });
      setRefreshKey((value) => value + 1);
      refreshHeaderSubscription();
    } catch (cause) {
      setPurchaseMessage({ kind: "error", text: cause instanceof Error ? cause.message : "The plan request could not be cancelled." });
    } finally { setCancelBusy(false); }
  }

  const subscriptionEnd = snapshot?.subscription?.status === "trialing"
    ? snapshot.subscription.trial_ends_at
    : snapshot?.subscription?.current_period_end;
  const endValue = subscriptionEnd ? Date.parse(subscriptionEnd) : NaN;
  const remainingDays = effectiveNow !== null && Number.isFinite(endValue) ? Math.max(0, Math.ceil((endValue - effectiveNow) / 86_400_000)) : null;
  const effectiveStatus = complimentaryAccess ? "active" : snapshot?.subscription && effectiveNow !== null
    ? effectiveSubscriptionStatus(snapshot.subscription.status, subscriptionEnd, effectiveNow)
    : snapshot?.subscription?.status ?? "";
  const pendingPlan = offers.find((item) => item.id === snapshot?.subscription?.pending_plan_id);
  const pendingCheckout = Boolean(snapshot?.pendingPayment && snapshot.subscription?.status === "past_due" && !snapshot.subscription.current_period_end && !snapshot.subscription.trial_ends_at);
  const pendingPlanId = snapshot?.subscription?.pending_plan_id ?? snapshot?.subscription?.plan_id ?? null;
  const pendingCycle = snapshot?.subscription?.pending_billing_cycle === "annual" ? "annual"
    : snapshot?.subscription?.pending_billing_cycle === "monthly" ? "monthly"
      : snapshot?.subscription?.billing_cycle === "annual" ? "annual" : "monthly";

  return (
    <WorkspaceLayout>
      <main className="bizbook-subscription-page mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <header className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-blue-700">Account plan</p><h1 className="mt-1.5 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">Plans & subscription</h1><p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-600 sm:text-sm">View your current access, compare plans, and renew your institute workspace.</p></div>
            <button type="button" onClick={retry} disabled={loading || scopeLoading || !institute} className="inline-flex min-h-9 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 sm:self-auto"><RefreshCw size={13} className={loading ? "animate-spin" : ""} />Refresh</button>
          </div>
        </header>

        {scopeError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><div className="flex items-start gap-2"><AlertCircle size={17} className="mt-0.5 shrink-0" /><span>{scopeError}</span></div><button type="button" onClick={refreshScope} className="mt-3 font-bold underline">Retry workspace access</button></div>}
        {!scopeLoading && !scopeError && !selection && <div className={`${cardClass} p-6 text-sm text-slate-600`}>An active institute membership is required to view its plan.</div>}
        {!scopeLoading && selection && institute && !canView && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><div className="flex items-start gap-3"><ShieldAlert size={19} className="mt-0.5 shrink-0" /><div><h2 className="font-bold">Plan management is limited</h2><p className="mt-1 leading-6">Only an institute owner or administrator can view billing details and purchase a plan. Ask your institute owner to renew access.</p></div></div></div>}
        {loading && <div role="status" className={`${cardClass} flex items-center gap-3 p-6 text-sm text-slate-600`}><RefreshCw size={17} className="animate-spin text-violet-700" />Loading your plan…</div>}
        {error && !scopeError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><div className="flex items-start gap-2"><AlertCircle size={17} className="mt-0.5 shrink-0" /><span>{error}</span></div><button type="button" onClick={retry} className="mt-3 font-bold underline">Retry</button></div>}

        {!scopeLoading && !scopeError && !loading && !error && snapshot && canView && (
          <>
            <section className={`${cardClass} overflow-hidden`} aria-labelledby="current-plan-heading">
              <div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-white to-violet-50/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex items-start gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-violet-100 text-violet-800"><CalendarClock size={21} /></span><div><p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-violet-700">{institute?.name}</p><h2 id="current-plan-heading" className="mt-1 text-lg font-black text-slate-950">{complimentaryAccess ? "Complimentary access" : pendingCheckout ? "Plan payment pending" : "Your current plan"}</h2></div></div>
                {snapshot.subscription && <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-bold ${statusClasses[subscriptionStatusTone(effectiveStatus)]}`}>{statusLabel(effectiveStatus)}</span>}
              </div>
              {complimentaryAccess ? (
                <div className="p-4 sm:p-5"><div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-cyan-50 p-3 sm:p-4"><p className="text-xs font-extrabold text-emerald-950">Your institute has complimentary BizBook access</p><p className="mt-1 text-xs leading-5 text-emerald-900">No subscription payment is required while Company Admin keeps this access enabled. Your records and payment history remain unchanged.{snapshot.pendingPayment ? " Any earlier payment request remains recorded separately and does not limit this access." : ""}</p></div></div>
              ) : pendingCheckout ? (
                <div className="p-4 sm:p-5"><div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-3 sm:p-4"><p className="text-xs font-extrabold text-amber-950">This plan becomes current after payment is confirmed</p><p className="mt-1 text-xs leading-5 text-amber-900">You selected {pendingPlan?.name ?? snapshot.plan?.name ?? "a BizBook plan"} · {snapshot.subscription?.pending_billing_cycle === "annual" ? "Yearly" : "Monthly"}. Complete the secure checkout below; the verified plan and access dates will then appear here.</p></div></div>
              ) : !snapshot.subscription ? (
                <div className="p-4 sm:p-5"><div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4"><h3 className="text-sm font-bold text-slate-900">No plan or demo trial is active</h3><p className="mt-1 text-xs leading-5 text-slate-600">Choose one of the plans below to restore full access to your institute workspace.</p></div></div>
              ) : (
                <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
                  <Metric label="Plan" value={snapshot.plan?.name ?? pendingPlan?.name ?? "Plan details unavailable"} />
                  <Metric label="Billing" value={snapshot.subscription.status === "trialing" ? "Free demo trial" : snapshot.subscription.billing_cycle === "annual" ? "Yearly" : "Monthly"} />
                  <Metric label={snapshot.subscription.status === "trialing" ? "Trial days left" : "Days remaining"} value={remainingDays === null ? subscriptionEnd ? "Calculating…" : "Not recorded" : effectiveStatus === "expired" ? "Expired" : `${remainingDays} day${remainingDays === 1 ? "" : "s"}`} />
                  <Metric label={snapshot.subscription.status === "trialing" ? "Trial ends" : "Access through"} value={formatSubscriptionDate(subscriptionEnd)} />
                  {snapshot.plan && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2 xl:col-span-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Plan includes</p><ul className="mt-2 grid gap-1">{safePlanFeatures(snapshot.plan.features).map((feature) => <li key={feature} className="flex items-start gap-1.5 text-[10px] leading-[14px] text-slate-700"><BadgeCheck size={11} className="mt-0.5 shrink-0 text-emerald-600" />{feature}</li>)}</ul><p className="mt-2 text-[10px] font-semibold leading-4 text-slate-600">Students: {planLimit(snapshot.plan.student_limit)} · Staff: {planLimit(snapshot.plan.staff_limit)} · Branches: {planLimit(snapshot.plan.branch_limit)}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{money.format(Number(snapshot.subscription.billing_cycle === "annual" ? snapshot.plan.annual_price : snapshot.plan.monthly_price))} / {snapshot.subscription.billing_cycle === "annual" ? "year" : "month"} · {snapshot.subscription.billing_cycle === "annual" ? snapshot.plan.annual_duration_days : snapshot.plan.monthly_duration_days} service days</p></div>}
                </div>
              )}
            </section>

            {effectiveStatus === "trialing" && !complimentaryAccess && <section className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 via-white to-violet-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5" aria-label="Free trial status">
              <div className="min-w-0"><p className="text-[9px] font-extrabold uppercase tracking-[0.17em] text-blue-700">Free trial active</p><p className="mt-1 text-sm font-extrabold text-slate-950">{snapshot.plan?.name ?? "Your BizBook plan"} · {remainingDays === null ? "End date unavailable" : `${remainingDays} day${remainingDays === 1 ? "" : "s"} left`}</p><p className="mt-1 text-xs leading-5 text-slate-600">Choose a monthly or yearly plan before {formatSubscriptionDate(subscriptionEnd)} to keep access uninterrupted.</p></div>
              <button type="button" aria-label="Go to available plans" onClick={() => document.getElementById("available-plans-heading")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg bg-blue-700 px-4 text-xs font-extrabold text-white shadow-sm hover:bg-blue-800">GO</button>
            </section>}

            <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="available-plans-heading">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div><p className="text-xs font-extrabold uppercase tracking-[0.15em] text-violet-700">Find your fit</p><h2 id="available-plans-heading" className="mt-1 text-lg font-black text-slate-950">All available plans</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Choose a billing period to view its price and included service days.</p></div>
                <div role="group" aria-label="Billing period" className="grid w-full grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1 lg:w-auto">
                  <button type="button" aria-pressed={billingCycle === "monthly"} onClick={() => setBillingCycle("monthly")} className={`min-h-10 rounded-lg px-4 text-sm font-extrabold transition ${billingCycle === "monthly" ? "bg-cyan-700 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}>Monthly</button>
                  <button type="button" aria-pressed={billingCycle === "annual"} onClick={() => setBillingCycle("annual")} className={`min-h-10 rounded-lg px-4 text-sm font-extrabold transition ${billingCycle === "annual" ? "bg-violet-700 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}>Yearly</button>
                </div>
              </div>
              {offersError && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{offersError}</p>}
              {offersLoading && <p role="status" className="mt-4 text-sm text-slate-500">Loading available plans…</p>}
              {!offersLoading && !offersError && offers.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">No plans are available right now. Please contact BizBook support.</p>}
              <div className="mt-3 grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">{offers.map((plan) => {
                const features = safePlanFeatures(plan.features);
                const isSelected = selectedPlanId === plan.id;
                const amount = billingCycle === "annual" ? plan.annual_price : plan.monthly_price;
                const compareAt = billingCycle === "annual" ? plan.annual_compare_at_price : plan.monthly_compare_at_price;
                const duration = billingCycle === "annual" ? plan.annual_duration_days : plan.monthly_duration_days;
                const pendingMatches = Boolean(snapshot.pendingPayment && pendingPlanId === plan.id && pendingCycle === billingCycle);
                const savingPercent = compareAt && compareAt > amount ? Math.round((1 - amount / compareAt) * 100) : 0;
                const checkoutBlocked = Boolean(snapshot.pendingPayment && !pendingMatches);
                return <article key={plan.id} className={`bizbook-plan-card relative flex flex-col overflow-hidden rounded-2xl border p-3.5 text-white shadow-[0_12px_32px_-24px_rgba(15,23,42,0.38)] transition ${isSelected ? "border-emerald-300 ring-2 ring-emerald-200/40" : "border-emerald-900 hover:border-emerald-400"}`}>
                  {plan.is_recommended && <span className="absolute right-3 top-3 rounded-full bg-lime-200 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-emerald-950">Popular</span>}
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-emerald-200">BizBook subscription</p>
                  <h3 className="mt-1 text-base font-black tracking-tight text-white">{plan.name}</h3>
                  <p className="mt-1 min-h-8 text-[11px] leading-4 text-emerald-50/90">{plan.description || "A complete shared workspace for managing your institute."}</p>
                  <div className="mt-2.5 rounded-xl border border-emerald-100/20 bg-emerald-950/30 p-3" aria-live="polite">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-emerald-200">{billingCycle === "annual" ? "Yearly plan" : "Monthly plan"}</span>{savingPercent > 0 && <span className="rounded-full bg-yellow-300 px-2 py-1 text-[9px] font-extrabold text-yellow-950">Save {savingPercent}%</span>}</div>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="break-words text-lg font-black tracking-tight tabular-nums text-white">{money.format(amount)}</span>{compareAt && compareAt > amount && <del className="text-[10px] font-extrabold text-[#FF334F]">{money.format(compareAt)}</del>}</div>
                    <p className="mt-1 text-[10px] font-semibold text-emerald-50">{duration} service days · {billingCycle === "annual" ? "yearly" : "monthly"} payment</p>
                    <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[9px] leading-4 text-emerald-100/85">{billingCycle === "annual" ? "Yearly billing" : "Monthly billing"} · {plan.availability_status === "available" ? "Available now" : plan.availability_status === "upcoming" ? "Available soon" : "Sales period ended"}</p>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-center">{[["Students", plan.student_limit], ["Staff", plan.staff_limit], ["Branches", plan.branch_limit]].map(([label, limit]) => <div key={String(label)} className="min-w-0 rounded-lg border border-white/10 bg-white/5 px-1 py-1.5"><p className="text-[9px] font-bold text-emerald-100/75">{label}</p><p className="mt-0.5 truncate text-[10px] font-extrabold tabular-nums text-white">{planLimit(limit as number | null)}</p></div>)}</div>
                  {features.length > 0 && <div className="mt-2 grid gap-1 rounded-xl border border-white/10 bg-black/10 p-2.5">{features.map((feature) => <p key={feature} className="flex min-w-0 items-start gap-1.5 text-[10px] leading-[14px] text-white/90"><BadgeCheck size={11} className="mt-0.5 shrink-0 text-lime-200" /><span>{feature}</span></p>)}</div>}
                  {snapshot.pendingPayment ? pendingMatches ? <Link aria-label={`Continue ${plan.name} plan checkout`} href={`/settings/subscription/checkout/${encodeURIComponent(snapshot.pendingPayment.id)}`} className="mt-auto inline-flex min-h-9 w-full items-center justify-center rounded-lg bg-gradient-to-r from-lime-300 to-emerald-300 px-3 text-xs font-extrabold text-emerald-950 shadow-sm transition hover:brightness-110">GO</Link> : <button type="button" disabled className="mt-auto inline-flex min-h-9 w-full items-center justify-center rounded-lg bg-white/15 px-3 text-[10px] font-bold text-white/60">Resolve pending checkout first</button>
                    : <button type="button" aria-label={`Choose ${plan.name}, ${billingCycle === "annual" ? "yearly" : "monthly"} plan`} aria-busy={purchaseBusy && selectedPlanId === plan.id} onClick={() => { setSelectedPlanId(plan.id); void purchaseSelectedPlan(plan.id, billingCycle); }} disabled={!plan.can_purchase || purchaseBusy || offersLoading} className="mt-auto inline-flex min-h-9 w-full items-center justify-center rounded-lg bg-gradient-to-r from-lime-300 to-emerald-300 px-3 text-xs font-extrabold text-emerald-950 shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">GO</button>}
                  {purchaseBusy && selectedPlanId === plan.id && <p role="status" className="mt-1 text-center text-[9px] text-slate-500">Preparing checkout…</p>}
                  {!plan.can_purchase && <p className="mt-1.5 text-[10px] font-semibold text-amber-700">{plan.availability_status === "upcoming" ? "Available soon" : "Unavailable"}</p>}
                  {checkoutBlocked && <p className="mt-1 text-center text-[9px] leading-[13px] text-amber-700">Your open invoice is for {pendingPlan?.name ?? snapshot.plan?.name ?? "another plan"} · {pendingCycle === "annual" ? "Yearly" : "Monthly"}. Continue it below before starting a different checkout.</p>}
                </article>;
              })}</div>
              {purchaseMessage && <p role={purchaseMessage.kind === "success" ? "status" : "alert"} className={`mt-4 rounded-xl border p-3 text-sm leading-6 ${purchaseMessage.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{purchaseMessage.text}</p>}
              {snapshot.pendingPayment && <div className="mt-4 flex flex-col gap-3 rounded-xl border-2 border-red-600 bg-white p-4 text-slate-950 shadow-[0_12px_30px_-18px_rgba(127,29,29,.3)] sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><p className="text-sm font-extrabold text-red-800">{complimentaryAccess || effectiveStatus === "trialing" || effectiveStatus === "active" ? "Optional checkout" : "Continue payment"}</p><p className="mt-1 text-xs leading-5 text-slate-700">{complimentaryAccess ? "Your complimentary access remains active while checkout is pending." : effectiveStatus === "trialing" ? "Your free trial stays active while checkout is pending." : effectiveStatus === "active" ? "Your current access stays active while checkout is pending." : "Access changes only after payment is confirmed."}</p></div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row"><Link aria-label="Go to subscription checkout" href={`/settings/subscription/checkout/${encodeURIComponent(snapshot.pendingPayment.id)}`} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-red-800 bg-[#8B0000] px-4 text-xs font-extrabold text-white transition-colors hover:border-red-700 hover:bg-white hover:text-red-700">GO</Link>{!snapshot.pendingPayment.attempt && <button type="button" disabled={cancelBusy} onClick={() => void cancelUnstartedInvoice()} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-red-200 bg-white px-4 text-xs font-extrabold text-red-800 hover:border-red-400 hover:bg-rose-50 disabled:opacity-60">{cancelBusy ? "Cancelling…" : "Cancel request & choose another"}</button>}</div>
              </div>}
            </section>

            <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-900">For safety, BizBook changes your plan only after a server-side provider check confirms the payment. Your plan and trial dates are controlled by the Company Admin.</p>
          </>
        )}
      </main>
    </WorkspaceLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-xs font-semibold text-slate-950">{value}</p></div>;
}
