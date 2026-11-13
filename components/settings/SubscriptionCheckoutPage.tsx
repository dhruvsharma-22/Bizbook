"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeCheck, CalendarDays, CircleAlert, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { useWorkspaceSubscription } from "@/components/layout/WorkspaceSubscriptionContext";
import { SubscriptionInvoiceCheckout } from "@/components/settings/SubscriptionInvoiceCheckout";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { canManageInstituteBilling } from "@/lib/supabase/subscription-access";

type CheckoutData = {
  invoice: { id: string; invoice_number: string; amount: number; currency: string; status: string };
  plan: { name: string; description: string | null; features: unknown; student_limit: number | null; staff_limit: number | null; branch_limit: number | null } | null;
  billingCycle: "monthly" | "annual";
  attempt: { id: string; provider: string; provider_order_id: string | null; status: string } | null;
};

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SubscriptionCheckoutPage({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const { institutes, selection, loading: scopeLoading, error: scopeError } = useWorkspaceScope();
  const { refresh: refreshSubscription } = useWorkspaceSubscription();
  const institute = institutes.find((item) => item.id === selection?.instituteId) ?? null;
  const canView = canManageInstituteBilling(institute);
  const [data, setData] = useState<CheckoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (instituteId: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) {
      throw new Error("This payment reference is invalid.");
    }
    const supabase = createSupabaseBrowserClient();
    const { data: invoice, error: invoiceError } = await supabase.from("platform_subscription_invoices")
      .select("id, subscription_id, invoice_number, amount, currency, status")
      .eq("id", invoiceId).eq("institute_id", instituteId).maybeSingle();
    if (invoiceError || !invoice) throw new Error("This plan payment could not be found for the selected institute.");
    if (!invoice.subscription_id) throw new Error("This payment is not linked to a subscription.");

    const { data: subscription, error: subscriptionError } = await supabase.from("institute_subscriptions")
      .select("plan_id, pending_plan_id, billing_cycle, pending_billing_cycle")
      .eq("id", invoice.subscription_id).eq("institute_id", instituteId).maybeSingle();
    if (subscriptionError || !subscription) throw new Error("The selected plan details could not be loaded.");
    const planId = subscription.pending_plan_id ?? subscription.plan_id;
    let plan: CheckoutData["plan"] = null;
    if (planId) {
      const { data: planRow, error: planError } = await supabase.from("platform_subscription_plans")
        .select("name, description, features, student_limit, staff_limit, branch_limit")
        .eq("id", planId).maybeSingle();
      if (planError) throw new Error("The selected plan details could not be loaded.");
      plan = planRow;
    }
    let attempt: CheckoutData["attempt"] = null;
    if (invoice.status !== "paid") {
      const { data: attemptRow, error: attemptError } = await supabase.from("platform_payment_attempts")
        .select("id, provider, provider_order_id, status")
        .eq("invoice_id", invoice.id).eq("institute_id", instituteId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (attemptError) throw new Error("The payment status could not be loaded.");
      attempt = attemptRow;
    }
    return {
      invoice: { ...invoice, amount: Number(invoice.amount) },
      plan,
      billingCycle: subscription.pending_billing_cycle ?? subscription.billing_cycle,
      attempt,
    } as CheckoutData;
  }, [invoiceId]);

  useEffect(() => {
    let active = true;
    if (scopeLoading || scopeError || !institute || !canView) return () => { active = false; };
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      setError("");
      try {
        const result = await load(institute.id);
        if (active) setData(result);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Checkout details could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [canView, institute, load, refreshKey, scopeError, scopeLoading]);

  const refresh = () => {
    setRefreshKey((value) => value + 1);
    refreshSubscription();
  };
  const features = Array.isArray(data?.plan?.features) ? data.plan.features.filter((item): item is string => typeof item === "string") : [];

  return <WorkspaceLayout>
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <Link href="/settings/subscription" className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-bold text-slate-600 hover:bg-white hover:text-violet-800"><ArrowLeft size={15} />Back to plans</Link>
      <header className="rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-900 p-5 text-white shadow-lg sm:p-7"><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-blue-200">Secure subscription checkout</p><h1 className="mt-1 text-2xl font-black">Review your plan</h1><p className="mt-1 text-sm text-blue-100">The amount below comes from the selected plan and billing period.</p></header>
      {scopeError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{scopeError}</p>}
      {!scopeLoading && institute && !canView && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Only an institute owner or administrator can pay for a plan.</p>}
      {loading && <p role="status" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600"><LoaderCircle size={16} className="animate-spin" />Loading the selected plan and amount…</p>}
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><div className="flex items-center gap-2"><CircleAlert size={16} />{error}</div><button type="button" onClick={refresh} className="mt-2 font-bold underline">Retry</button></div>}
      {!loading && !error && data && institute && <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><CalendarDays size={18} /></span><div><p className="text-[10px] font-extrabold uppercase tracking-wide text-blue-700">{institute.name}</p><h2 className="mt-1 text-xl font-black text-slate-950">{data.plan?.name ?? "BizBook plan"}</h2><p className="mt-1 text-sm text-slate-600">{data.plan?.description || "A complete shared workspace for managing your institute."}</p></div></div>
          <div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3"><p className="text-[10px] font-extrabold uppercase text-cyan-800">Billing period</p><p className="mt-1 text-sm font-bold text-slate-950">{data.billingCycle === "annual" ? "Yearly" : "Monthly"}</p></div><div className="rounded-xl border border-blue-100 bg-blue-50 p-3"><p className="text-[10px] font-extrabold uppercase text-blue-800">Payment reference</p><p className="mt-1 truncate text-sm font-bold text-slate-950">{data.invoice.invoice_number}</p></div></div>
          <div className="mt-5 space-y-2">{features.map((feature) => <p key={feature} className="flex items-start gap-2 text-sm leading-5 text-slate-700"><BadgeCheck size={15} className="mt-0.5 shrink-0 text-emerald-600" />{feature}</p>)}{data.plan && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Students: {data.plan.student_limit ?? "Unlimited"} · Staff: {data.plan.staff_limit ?? "Unlimited"} · Branches: {data.plan.branch_limit ?? "Unlimited"}</p>}</div>
        </section>
        <section className="h-fit rounded-2xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">Payment summary</p><h2 className="mt-1 text-lg font-black text-slate-950">Amount due</h2><p className="mt-3 text-3xl font-black tracking-tight text-slate-950">{money.format(data.invoice.amount)}</p><p className="mt-1 text-xs text-slate-500">INR · {data.billingCycle === "annual" ? "Yearly" : "Monthly"} plan · server-calculated</p>
          {data.invoice.status === "paid" ? <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">This plan payment is confirmed. Your active plan is being refreshed.</p>
            : !["open", "past_due"].includes(data.invoice.status) ? <p role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">This payment is {data.invoice.status} and cannot be checked out. Return to Plans & Subscription or contact BizBook support.</p>
            : data.attempt?.status === "reconciliation_required" || data.attempt?.status === "authorized" ? <p role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">The provider is still confirming this payment. Do not start another attempt; refresh later or contact BizBook support.</p>
              : data.attempt?.status === "created" && data.attempt.provider === "razorpay" && !data.attempt.provider_order_id ? <p role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">The Razorpay order has an uncertain result. Do not retry checkout until BizBook support reviews it.</p>
              : <SubscriptionInvoiceCheckout key={`${data.invoice.id}:${data.attempt?.id ?? "new"}`} invoiceId={data.invoice.id} amount={data.invoice.amount} instituteName={institute.name}
                  {...(data.attempt && (data.attempt.status === "pending" || (data.attempt.status === "created" && data.attempt.provider === "cashfree")) ? { existingAttemptId: data.attempt.id, existingProvider: data.attempt.provider as "razorpay" | "cashfree" } : {})}
                  onUpdated={refresh} onPaid={() => { refreshSubscription(); router.push("/settings/subscription?payment=complete"); }} />}
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-5 text-slate-600"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-slate-500" />Your plan starts only after a server-side provider check confirms payment. No payment is marked complete from this page alone.</p>
          <Link href="/settings/subscription" className="mt-4 inline-flex min-h-9 items-center gap-2 text-xs font-bold text-blue-800 hover:underline"><RefreshCw size={13} />Return to plan details</Link>
        </section>
      </div>}
      {!institute && !scopeLoading && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Select an institute workspace to continue.</p>}
    </main>
  </WorkspaceLayout>;
}
