"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, CalendarDays, CheckCircle2, CircleAlert, CreditCard, LoaderCircle, Plus, RefreshCw, Save, Users } from "lucide-react";

type Plan = {
  id: string; name: string; description: string | null; monthly_price: number; annual_price: number;
  monthly_compare_at_price: number | null; annual_compare_at_price: number | null;
  available_from: string | null; available_until: string | null;
  monthly_duration_days: number; annual_duration_days: number; is_available: boolean;
  student_limit: number | null; staff_limit: number | null; branch_limit: number | null;
  features: unknown; is_recommended: boolean;
};
type Counts = { active: number; trialing: number; total: number };
type Catalog = { plans: Plan[]; subscriptionsByPlan: Record<string, Counts>; canEdit: boolean };
type FormState = { planId: string | null; name: string; description: string; monthly: string; annual: string; monthlyCompare: string; annualCompare: string; startsOn: string; endsOn: string; monthlyDays: string; annualDays: string; studentLimit: string; staffLimit: string; branchLimit: string; features: string; isRecommended: boolean; isAvailable: boolean };
type TrialConfig = { enabled: boolean; duration_days: number; plan_id: string | null; for_new_accounts: boolean; plan_name?: string | null; plan_features?: unknown; student_limit?: number | null; staff_limit?: number | null; branch_limit?: number | null };

const blankForm = (): FormState => ({ planId: null, name: "", description: "", monthly: "", annual: "", monthlyCompare: "", annualCompare: "", startsOn: "", endsOn: "", monthlyDays: "30", annualDays: "365", studentLimit: "", staffLimit: "", branchLimit: "", features: "Students and admissions\nAttendance and payroll\nPayments, refunds and expenses\nDashboard and financial reports\nRole-based access", isRecommended: false, isAvailable: true });
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50";
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

function isPlan(value: unknown): value is Plan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.id === "string" && typeof plan.name === "string" && typeof plan.monthly_price === "number"
    && typeof plan.annual_price === "number" && typeof plan.monthly_duration_days === "number"
    && typeof plan.annual_duration_days === "number" && typeof plan.is_available === "boolean";
}
function featureItems(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : [];
  return items.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

export default function PlatformPlanPricing() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trialConfig, setTrialConfig] = useState<TrialConfig | null>(null);
  const [trialPlanId, setTrialPlanId] = useState("");
  const [trialDays, setTrialDays] = useState("14");
  const [trialEnabled, setTrialEnabled] = useState(false);
  const [trialForNewAccounts, setTrialForNewAccounts] = useState(true);
  const [trialBusy, setTrialBusy] = useState(false);

  const refresh = useCallback(async (keepPlanId?: string | null) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/platform-admin/plans", { cache: "no-store" });
      const result = await response.json() as { plans?: unknown; subscriptionsByPlan?: unknown; canEdit?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error || "Plan prices could not be loaded.");
      const plans = Array.isArray(result.plans) ? result.plans.filter(isPlan) : [];
      const counts = result.subscriptionsByPlan && typeof result.subscriptionsByPlan === "object" && !Array.isArray(result.subscriptionsByPlan)
        ? result.subscriptionsByPlan as Record<string, Counts> : {};
      setCatalog({ plans, subscriptionsByPlan: counts, canEdit: result.canEdit === true });
      const selected = plans.find((plan) => plan.id === keepPlanId) ?? plans[0] ?? null;
      if (selected) setForm({ planId: selected.id, name: selected.name, monthly: String(selected.monthly_price), annual: String(selected.annual_price),
        description: selected.description ?? "", studentLimit: selected.student_limit == null ? "" : String(selected.student_limit), staffLimit: selected.staff_limit == null ? "" : String(selected.staff_limit), branchLimit: selected.branch_limit == null ? "" : String(selected.branch_limit),
        features: featureItems(selected.features).join("\n"),
        monthlyCompare: selected.monthly_compare_at_price === null ? "" : String(selected.monthly_compare_at_price),
        annualCompare: selected.annual_compare_at_price === null ? "" : String(selected.annual_compare_at_price),
        startsOn: selected.available_from ?? "", endsOn: selected.available_until ?? "",
        monthlyDays: String(selected.monthly_duration_days), annualDays: String(selected.annual_duration_days), isRecommended: selected.is_recommended, isAvailable: selected.is_available });
      else setForm(blankForm());
      const trialResponse = await fetch("/api/platform-admin/trials", { cache: "no-store" });
      const trialResult = await trialResponse.json() as { config?: TrialConfig; plans?: unknown; canEdit?: boolean; error?: string };
      if (!trialResponse.ok || !trialResult.config) throw new Error(trialResult.error || "Trial settings could not be loaded.");
      setTrialConfig(trialResult.config); setTrialEnabled(trialResult.config.enabled); setTrialDays(String(trialResult.config.duration_days)); setTrialPlanId(trialResult.config.plan_id ?? ""); setTrialForNewAccounts(trialResult.config.for_new_accounts);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Plan prices could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void Promise.resolve().then(() => refresh()); }, [refresh]);
  const selectedPlan = useMemo(() => catalog?.plans.find((plan) => plan.id === form.planId) ?? null, [catalog?.plans, form.planId]);
  const subscribers = selectedPlan ? catalog?.subscriptionsByPlan[selectedPlan.id] : null;

  function selectPlan(plan: Plan) {
    setError(""); setNotice("");
    setForm({ planId: plan.id, name: plan.name, monthly: String(plan.monthly_price), annual: String(plan.annual_price),
      description: plan.description ?? "", studentLimit: plan.student_limit == null ? "" : String(plan.student_limit), staffLimit: plan.staff_limit == null ? "" : String(plan.staff_limit), branchLimit: plan.branch_limit == null ? "" : String(plan.branch_limit),
      features: featureItems(plan.features).join("\n"),
      monthlyCompare: plan.monthly_compare_at_price === null ? "" : String(plan.monthly_compare_at_price),
      annualCompare: plan.annual_compare_at_price === null ? "" : String(plan.annual_compare_at_price),
      startsOn: plan.available_from ?? "", endsOn: plan.available_until ?? "",
      monthlyDays: String(plan.monthly_duration_days), annualDays: String(plan.annual_duration_days), isRecommended: plan.is_recommended, isAvailable: plan.is_available });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !catalog?.canEdit) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform-admin/plans", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: form.planId, name: form.name, description: form.description, monthlyPrice: form.monthly, annualPrice: form.annual,
          monthlyCompareAtPrice: form.monthlyCompare || null, annualCompareAtPrice: form.annualCompare || null,
          availableFrom: form.startsOn || null, availableUntil: form.endsOn || null,
          monthlyDurationDays: Number(form.monthlyDays), annualDurationDays: Number(form.annualDays),
          studentLimit: form.studentLimit === "" ? null : Number(form.studentLimit), staffLimit: form.staffLimit === "" ? null : Number(form.staffLimit), branchLimit: form.branchLimit === "" ? null : Number(form.branchLimit),
          features: form.features.split("\n").map((item) => item.trim()).filter(Boolean), isRecommended: form.isRecommended, isAvailable: form.isAvailable }) });
      const result = await response.json() as { error?: string; planId?: string };
      if (!response.ok) throw new Error(result.error || "Plan could not be saved.");
      const savedId = typeof result.planId === "string" ? result.planId : form.planId;
      setNotice(`“${form.name.trim()}” ${form.planId ? "updated" : "created"}. New subscriptions now use the saved amounts and availability window.`);
      await refresh(savedId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Plan could not be saved."); }
    finally { setBusy(false); }
  }

  async function saveTrial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (trialBusy || !catalog?.canEdit) return;
    setTrialBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform-admin/trials", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: trialEnabled, durationDays: Number(trialDays), planId: trialPlanId || null, forNewAccounts: trialForNewAccounts }) });
      const result = await response.json() as { config?: TrialConfig; error?: string };
      if (!response.ok || !result.config) throw new Error(result.error || "Trial settings could not be saved.");
      setTrialConfig(result.config); setNotice("New-account trial policy saved. Existing trial end dates are unchanged.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Trial settings could not be saved."); }
    finally { setTrialBusy(false); }
  }

  async function deleteSelectedPlan() {
    if (!form.planId || !catalog?.canEdit || busy || !window.confirm("Delete this plan permanently? Plans with subscriptions or trial history must be deactivated instead.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform-admin/plans", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: form.planId }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Plan could not be deleted.");
      setNotice("Plan deleted."); setForm(blankForm()); await refresh(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Plan could not be deleted."); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(145deg,#eff6ff_0%,#f8fafc_50%,#eef2ff_100%)] px-4 py-5 text-slate-950 sm:px-7 sm:py-8 xl:px-10">
      <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8">
        <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 p-4 text-white shadow-lg shadow-blue-950/15 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/platform-admin" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-bold text-blue-50 transition hover:bg-white/15"><ArrowLeft size={15} />Company Admin</Link>
            <button type="button" onClick={() => void refresh(form.planId)} disabled={loading} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-bold transition hover:bg-white/15 disabled:opacity-60"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh</button>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] lg:items-end">
            <div className="max-w-3xl"><p className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-blue-200"><CreditCard size={14} />Subscriptions</p>
              <h1 className="mt-1.5 text-2xl font-black tracking-tight sm:text-3xl">Plan pricing</h1>
              <p className="mt-1.5 text-xs leading-5 text-blue-100 sm:text-sm">Manage plans, pricing, usage limits, service days, and trial policy. Saved changes are audited; existing invoices keep their saved amounts.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[320px]">
              <HeroStat label="Active for this plan" value={loading ? "—" : String(subscribers?.active ?? 0)} icon={Users} />
              <HeroStat label="Total for this plan" value={loading ? "—" : String(subscribers?.total ?? 0)} icon={BadgeCheck} />
            </div>
          </div>
        </header>

        {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-900"><CircleAlert size={18} className="mt-0.5 shrink-0" />{error}</div>}
        {notice && <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{notice}</div>}
        {catalog && !catalog.canEdit && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">View-only access. A BizBook Company Admin owner must save plan changes.</div>}

        <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-5 shadow-sm sm:p-7">
          <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-emerald-700">New account policy</p><h2 className="mt-1 text-xl font-extrabold">Free trial settings</h2><p className="mt-1 text-sm leading-6 text-slate-600">These settings apply only to future eligible accounts when both switches are on. They do not change an existing institute. To grant one a trial now, use Institute Directory → Manage subscription and set its status to Trialing.</p></div>
          {trialConfig && <form onSubmit={(event) => void saveTrial(event)} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-emerald-100 bg-white px-3 text-sm font-bold text-slate-800"><input type="checkbox" checked={trialEnabled} onChange={(event) => setTrialEnabled(event.target.checked)} disabled={!catalog?.canEdit || trialBusy} className="size-4 accent-emerald-700" />Enable free trials for eligible new accounts</label>
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-emerald-100 bg-white px-3 text-sm font-bold text-slate-800"><input type="checkbox" checked={trialForNewAccounts} onChange={(event) => setTrialForNewAccounts(event.target.checked)} disabled={!catalog?.canEdit || trialBusy} className="size-4 accent-emerald-700" />Offer to eligible new accounts</label>
            <label className="text-xs font-bold text-slate-700">Demo trial duration in days<input className={`${inputClass} mt-1.5`} type="number" min="1" max="365" step="1" value={trialDays} onChange={(event) => setTrialDays(event.target.value)} required disabled={!catalog?.canEdit || trialBusy || !trialEnabled} /><span className="mt-1 block font-normal text-slate-500">Enter 1 or 2 for a short demo. Each eligible account receives the saved trial only once.</span></label>
            <label className="text-xs font-bold text-slate-700">Trial plan and included access<select className={`${inputClass} mt-1.5`} value={trialPlanId} onChange={(event) => setTrialPlanId(event.target.value)} required={trialEnabled} disabled={!catalog?.canEdit || trialBusy || !trialEnabled}><option value="">Select a plan</option>{catalog?.plans.filter((plan) => plan.is_available).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
            <div className="rounded-xl border border-emerald-100 bg-white p-3 text-xs leading-5 text-slate-600 md:col-span-2">Trial access uses the selected plan&apos;s saved feature list and student, staff, and branch limits. These values are persisted; enforcement is available only where BizBook has an explicit server-side usage policy.</div>
            <button type="submit" disabled={!catalog?.canEdit || trialBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50 md:col-span-2">{trialBusy ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}Save trial policy</button>
          </form>}
        </section>

        <section className="rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50/70 p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-blue-700">Plan catalog</p><h2 className="mt-1 text-xl font-extrabold">Choose a plan to edit</h2></div>
            <button type="button" disabled={!catalog?.canEdit || loading || busy} onClick={() => { setForm(blankForm()); setError(""); setNotice(""); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-extrabold text-white hover:bg-blue-800 disabled:opacity-50"><Plus size={17} />Add plan</button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog?.plans.map((plan) => { const count = catalog.subscriptionsByPlan[plan.id]?.total ?? 0; return <button key={plan.id} type="button" onClick={() => selectPlan(plan)} className={`rounded-2xl border p-4 text-left transition ${form.planId === plan.id ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"}`}>
              <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate font-extrabold text-slate-950">{plan.name}</span><span className="mt-1 block text-xs text-slate-500">{money.format(plan.monthly_price)} monthly · {money.format(plan.annual_price)} yearly</span></span><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold ${plan.is_available ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{plan.is_available ? "On" : "Off"}</span></span>
              <span className="mt-3 block text-[11px] font-semibold text-slate-500">{count} subscription{count === 1 ? "" : "s"}</span>
            </button>; })}
            {!loading && !catalog?.plans.length && <div className="rounded-2xl border border-dashed border-blue-300 bg-blue-50/60 p-5 text-sm leading-6 text-slate-700 sm:col-span-2 lg:col-span-3">No plans have been set up yet. Add your first plan, enter its monthly and yearly amounts, then save it to publish it on the public Plans page.</div>}
          </div>
        </section>

        <div className="grid items-start gap-5 lg:grid-cols-[1fr_0.8fr]">
          <section className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-purple-50/70 p-5 shadow-sm sm:p-7">
            <div className="rounded-2xl border border-violet-100 bg-violet-50/90 px-4 py-4 sm:px-5"><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-violet-800">Plan configuration</p><h2 className="mt-1.5 text-xl font-extrabold">{form.planId ? `Edit ${selectedPlan?.name ?? "plan"}` : "Add a plan"}</h2><p className="mt-1.5 text-sm leading-5 text-slate-600">Price, service period, signup window, and visibility are controlled here.</p></div>
            <form onSubmit={submit} className="mt-5 space-y-5">
              <label className="block text-xs font-bold text-slate-700">Public plan name<input className={`${inputClass} mt-1.5`} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={80} minLength={2} required disabled={!catalog?.canEdit || busy} placeholder="For example, BizBook Pro" /></label>
              <label className="block text-xs font-bold text-slate-700">Description<textarea className={`${inputClass} mt-1.5 min-h-20 resize-y`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={500} disabled={!catalog?.canEdit || busy} placeholder="Describe who this plan is for." /></label>
              <PriceField label="Monthly price" value={form.monthly} compareValue={form.monthlyCompare} onValue={(monthly) => setForm((current) => ({ ...current, monthly }))} onCompare={(monthlyCompare) => setForm((current) => ({ ...current, monthlyCompare }))} disabled={!catalog?.canEdit || busy} />
              <PriceField label="Yearly price" value={form.annual} compareValue={form.annualCompare} onValue={(annual) => setForm((current) => ({ ...current, annual }))} onCompare={(annualCompare) => setForm((current) => ({ ...current, annualCompare }))} disabled={!catalog?.canEdit || busy} />
              <fieldset className="rounded-2xl border border-emerald-100 bg-emerald-50/55 p-4"><legend className="px-1 text-xs font-extrabold text-emerald-800">Service days</legend><p className="mb-3 text-xs leading-5 text-slate-600">How many days a monthly or yearly payment covers.</p><div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-700">Monthly days<input className={`${inputClass} mt-1.5`} type="number" min="1" max="3660" step="1" value={form.monthlyDays} onChange={(event) => setForm((current) => ({ ...current, monthlyDays: event.target.value }))} required disabled={!catalog?.canEdit || busy} /></label>
                <label className="text-xs font-bold text-slate-700">Yearly days<input className={`${inputClass} mt-1.5`} type="number" min="1" max="3660" step="1" value={form.annualDays} onChange={(event) => setForm((current) => ({ ...current, annualDays: event.target.value }))} required disabled={!catalog?.canEdit || busy} /></label>
              </div></fieldset>
              <fieldset className="rounded-2xl border border-violet-100 bg-violet-50/65 p-4"><legend className="px-1 text-xs font-extrabold text-violet-800">Signup availability</legend><p className="mb-3 text-xs leading-5 text-slate-600">Outside this date range the plan is visible but cannot be selected by a new signup.</p><div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-700">Starts on<input className={`${inputClass} mt-1.5`} type="date" value={form.startsOn} onChange={(event) => setForm((current) => ({ ...current, startsOn: event.target.value }))} disabled={!catalog?.canEdit || busy} /></label>
                <label className="text-xs font-bold text-slate-700">Ends on<input className={`${inputClass} mt-1.5`} type="date" value={form.endsOn} min={form.startsOn || undefined} onChange={(event) => setForm((current) => ({ ...current, endsOn: event.target.value }))} disabled={!catalog?.canEdit || busy} /></label>
              </div><label className="mt-4 flex min-h-11 items-center gap-3 rounded-xl border border-white bg-white px-3 text-sm font-bold text-slate-800"><input type="checkbox" checked={form.isAvailable} onChange={(event) => setForm((current) => ({ ...current, isAvailable: event.target.checked }))} disabled={!catalog?.canEdit || busy} className="size-4 accent-blue-700" />Show this plan to new customers</label></fieldset>
              <fieldset className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4"><legend className="px-1 text-xs font-extrabold text-indigo-800">Usage limits</legend><p className="mb-3 text-xs text-slate-600">Leave blank for unlimited. Limits are enforced by database rules where a supported limit exists.</p><div className="grid gap-3 sm:grid-cols-3">{([["Students", "studentLimit"], ["Staff", "staffLimit"], ["Branches", "branchLimit"]] as const).map(([label, key]) => <label key={key} className="text-xs font-bold text-slate-700">{label}<input className={`${inputClass} mt-1.5`} type="number" min="0" step="1" value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} disabled={!catalog?.canEdit || busy} placeholder="Unlimited" /></label>)}</div></fieldset>
              <label className="block text-xs font-bold text-slate-700">Included features<textarea className={`${inputClass} mt-1.5 min-h-32 resize-y`} value={form.features} onChange={(event) => setForm((current) => ({ ...current, features: event.target.value }))} disabled={!catalog?.canEdit || busy} placeholder="One feature per line" /><span className="mt-1 block font-normal text-slate-500">Up to 20 lines. Shown to customers and used in trial access details.</span></label>
              <label className="flex min-h-11 items-center gap-3 rounded-xl border border-fuchsia-100 bg-fuchsia-50 px-3 text-sm font-bold text-fuchsia-950"><input type="checkbox" checked={form.isRecommended} onChange={(event) => setForm((current) => ({ ...current, isRecommended: event.target.checked }))} disabled={!catalog?.canEdit || busy} className="size-4 accent-fuchsia-700" />Mark as recommended</label>
              {form.planId && <div className="flex flex-wrap gap-2"><button type="button" disabled={!catalog?.canEdit || busy} onClick={() => setForm((current) => ({ ...current, planId: null, name: `${current.name} Copy`.slice(0, 80) }))} className="min-h-10 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-800 disabled:opacity-50">Duplicate plan</button><button type="button" disabled={!catalog?.canEdit || busy || (subscribers?.total ?? 0) > 0} onClick={() => void deleteSelectedPlan()} className="min-h-10 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-800 disabled:opacity-50">Delete plan</button><span className="self-center text-[10px] text-slate-500">Plans with subscription history must be turned off.</span></div>}
              <button type="submit" disabled={!catalog?.canEdit || busy || loading} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-extrabold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-55">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Save size={17} />}{form.planId ? "Save plan changes" : "Create and publish plan"}</button>
            </form>
          </section>
          <aside className="space-y-4"><section className="rounded-3xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-pink-50/70 p-5 shadow-sm sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.17em] text-fuchsia-800">Customer page</p><h2 className="mt-1.5 text-lg font-extrabold">Plan preview</h2></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${form.isAvailable ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{form.isAvailable ? "Visible" : "Hidden"}</span></div>
            <div className="mt-4 rounded-2xl bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 p-5 text-white"><p className="text-xs font-extrabold uppercase tracking-[0.15em] text-blue-200">BizBook subscription</p><h3 className="mt-2 text-2xl font-black">{form.name || "Your plan name"}</h3><p className="mt-2 text-xs leading-5 text-blue-100">{form.description || "Your plan description"}</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><PriceSummary label="Monthly" amount={Number(form.monthly) || 0} compare={Number(form.monthlyCompare) || null} days={Number(form.monthlyDays) || 30} /><PriceSummary label="Yearly" amount={Number(form.annual) || 0} compare={Number(form.annualCompare) || null} days={Number(form.annualDays) || 365} /></div><ul className="mt-4 space-y-1 text-xs text-blue-50">{form.features.split("\n").filter(Boolean).slice(0, 8).map((feature, index) => <li key={`${index}-${feature}`}>✓ {feature}</li>)}</ul></div>
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-violet-50 p-3 text-xs leading-5 text-violet-900"><CalendarDays size={15} className="mt-0.5 shrink-0" />{form.startsOn || form.endsOn ? `${form.startsOn || "No start date"} — ${form.endsOn || "No end date"}` : "No signup date limits"}</p>
            <p className="mt-3 text-xs leading-5 text-slate-600">The saved price is copied to each new invoice. Changing a plan later does not rewrite existing invoices.</p>
          </section><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-950"><strong>Payment availability:</strong> checkout requires a verified central sandbox provider. A plan can be published before payment is configured, but customers cannot complete payment until the provider is ready. Live billing remains disabled.</div></aside>
        </div>
      </div>
    </main>
  );
}

function HeroStat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof CreditCard }) {
  return <div className="flex min-h-14 items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2"><div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-blue-200">{label}</p><p className="mt-0.5 text-lg font-black leading-5">{value}</p></div><Icon size={16} className="shrink-0 text-blue-200" /></div>;
}
function PriceField({ label, value, compareValue, onValue, onCompare, disabled }: { label: string; value: string; compareValue: string; onValue: (value: string) => void; onCompare: (value: string) => void; disabled: boolean }) {
  return <fieldset className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4"><legend className="px-1 text-xs font-extrabold text-blue-800">{label}</legend><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-700">Current amount (INR)<input className={`${inputClass} mt-1.5`} type="number" min="0.01" max="9999999999.99" step="0.01" value={value} onChange={(event) => onValue(event.target.value)} required disabled={disabled} placeholder="0.00" /></label><label className="text-xs font-bold text-slate-700">Optional original amount<input className={`${inputClass} mt-1.5`} type="number" min="0.01" max="9999999999.99" step="0.01" value={compareValue} onChange={(event) => onCompare(event.target.value)} disabled={disabled} placeholder="Shown crossed out" /><span className="mt-1 block text-[10px] font-normal text-slate-500">Shown crossed out only when it is above current amount.</span></label></div></fieldset>;
}
function PriceSummary({ label, amount, compare, days }: { label: string; amount: number; compare: number | null; days: number }) {
  return <div className="rounded-xl bg-white/10 px-3.5 py-3"><p className="text-[10px] font-extrabold uppercase tracking-wide text-blue-200">{label}</p><div className="mt-1 flex flex-wrap items-baseline gap-x-2"><span className="text-lg font-black">{amount ? money.format(amount) : "₹—"}</span>{compare && compare > amount && <span className="text-xs font-bold text-rose-300 line-through">{money.format(compare)}</span>}<span className="text-[10px] font-semibold text-blue-100">/ {days} days</span></div></div>;
}
