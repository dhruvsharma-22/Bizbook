"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, BellRing, BookOpenCheck, Building2, CalendarDays, Check, ChevronDown, CreditCard, LoaderCircle, ReceiptText, ShieldCheck, Sparkles, UsersRound } from "lucide-react";

type Plan = {
  id: string; name: string; description: string | null; monthly_price: number; annual_price: number;
  monthly_compare_at_price: number | null; annual_compare_at_price: number | null;
  available_from: string | null; available_until: string | null; monthly_duration_days: number; annual_duration_days: number;
  can_purchase: boolean; availability_status: "upcoming" | "available" | "expired"; features?: unknown;
  student_limit?: number | null; staff_limit?: number | null; branch_limit?: number | null; is_recommended?: boolean;
};
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const included = [
  { icon: UsersRound, title: "Students and admissions", detail: "Profiles, fee schedules, admission fees and student status." },
  { icon: BookOpenCheck, title: "Attendance and payroll", detail: "Staff records, attendance tracking and salary history." },
  { icon: ReceiptText, title: "Payments and refunds", detail: "Manual receipts, advance allocation and refund tracking." },
  { icon: CreditCard, title: "Outstanding fee reports", detail: "View installment balances and overdue fees." },
  { icon: Building2, title: "Institute expenses", detail: "Record expenses, fixed monthly costs and expense payments." },
  { icon: CalendarDays, title: "Dashboard and reports", detail: "Review collections, refunds, payroll and expenses by month." },
  { icon: ShieldCheck, title: "Role-based access", detail: "Give team members access according to their institute role." },
  { icon: BellRing, title: "Workspace reminders", detail: "Keep due monthly expense obligations visible to your team." },
];
function isPlan(value: unknown): value is Plan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.id === "string" && typeof plan.name === "string" && typeof plan.monthly_price === "number"
    && typeof plan.annual_price === "number" && typeof plan.monthly_duration_days === "number"
    && typeof plan.annual_duration_days === "number" && typeof plan.can_purchase === "boolean"
    && (plan.availability_status === "upcoming" || plan.availability_status === "available" || plan.availability_status === "expired");
}
function featureItems(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : [];
  return items.filter((item): item is string => typeof item === "string");
}
function date(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(year, month - 1, day, 12));
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [cycle, setCycle] = useState<"monthly" | "annual">("annual");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [expandedPlans, setExpandedPlans] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return null;
      setLoading(true); setError("");
      return fetch("/api/plans", { cache: "no-store" });
    }).then(async (response) => {
      if (!response) return;
      const result = await response.json() as { plans?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error || "Plan details are temporarily unavailable.");
      if (active) setPlans(Array.isArray(result.plans) ? result.plans.filter(isPlan) : []);
    }).catch((cause: unknown) => { if (active) { setPlans([]); setError(cause instanceof Error ? cause.message : "Plan details are temporarily unavailable."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,_#f1eaff_0%,_#faf9ff_38%,_#f8fafc_78%)] text-slate-900">
      <header className="border-b border-violet-100/80 bg-white/85 backdrop-blur-xl"><div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-2.5"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-200"><Building2 size={19} /></span><span className="truncate text-base font-extrabold tracking-tight text-slate-950">BizBook</span></Link>
        <div className="flex shrink-0 items-center gap-2"><Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-violet-50 hover:text-violet-800">Sign in</Link><a href="#plans" className="rounded-lg bg-gradient-to-r from-violet-700 to-indigo-600 px-3.5 py-2 text-sm font-bold text-white shadow-md shadow-violet-200 transition hover:brightness-105">View plans</a></div>
      </div></header>

      <section className="relative mx-auto max-w-7xl px-4 pb-7 pt-9 sm:px-6 sm:pb-10 sm:pt-12 lg:px-8"><div className="pointer-events-none absolute -right-28 -top-20 size-80 rounded-full bg-violet-300/30 blur-3xl" />
        <div className="relative mx-auto max-w-3xl text-center"><span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] text-violet-800 shadow-sm"><Sparkles size={14} />One complete workspace</span>
          <h1 className="mt-5 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">Clear pricing. Your whole institute.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">Create your BizBook account first. Review and purchase a plan later from your subscription settings.</p>
          <div className="mx-auto mt-6 inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1 shadow-inner" role="group" aria-label="Billing cycle"><button type="button" onClick={() => setCycle("monthly")} aria-pressed={cycle === "monthly"} className={`rounded-lg px-4 py-2 text-xs font-extrabold transition ${cycle === "monthly" ? "bg-white text-violet-900 shadow-sm" : "text-slate-600 hover:bg-white/70"}`}>Monthly</button><button type="button" onClick={() => setCycle("annual")} aria-pressed={cycle === "annual"} className={`rounded-lg px-4 py-2 text-xs font-extrabold transition ${cycle === "annual" ? "bg-violet-700 text-white shadow-sm" : "text-slate-600 hover:bg-white/70"}`}>Yearly</button></div>
        </div>
      </section>

      <section id="plans" className="mx-auto max-w-7xl scroll-mt-5 px-4 pb-10 sm:px-6 lg:px-8">
        {loading && <div role="status" className="flex items-center justify-center gap-2 rounded-3xl border border-violet-100 bg-white p-10 text-sm font-semibold text-violet-800 shadow-sm"><LoaderCircle size={18} className="animate-spin" />Loading plans…</div>}
        {error && <div role="alert" className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center"><p className="font-bold text-rose-950">Plans could not be loaded</p><p className="mt-2 text-sm text-rose-800">{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-bold text-rose-800 shadow-sm">Retry</button></div>}
        {!loading && !error && plans.length === 0 && <div className="mx-auto max-w-2xl rounded-3xl border border-violet-100 bg-white p-7 text-center shadow-sm"><p className="text-lg font-extrabold text-slate-950">Plans are being prepared</p><p className="mt-2 text-sm leading-6 text-slate-600">The BizBook team has not published a priced plan yet. Please check back soon.</p></div>}
        {!loading && !error && plans.length > 0 && <div className="grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-3">{plans.map((plan) => {
          const amount = cycle === "annual" ? plan.annual_price : plan.monthly_price;
          const compare = cycle === "annual" ? plan.annual_compare_at_price : plan.monthly_compare_at_price;
          const days = cycle === "annual" ? plan.annual_duration_days : plan.monthly_duration_days;
          const period = cycle === "annual" ? "year" : "month";
          const href = "/login?next=%2Fsettings%2Fsubscription";
          const features = featureItems(plan.features);
          const expanded = expandedPlans.includes(plan.id);
          const visibleFeatures = expanded ? features : features.slice(0, 5);
          return <article key={plan.id} className={`relative flex flex-col overflow-hidden rounded-[26px] border p-5 shadow-[0_16px_42px_-30px_rgba(55,48,163,.3)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_22px_48px_-30px_rgba(55,48,163,.38)] sm:p-6 ${plan.is_recommended ? "border-violet-300 bg-gradient-to-b from-violet-50 via-white to-white ring-1 ring-violet-100" : "border-slate-200 bg-white"}`}>
            <div aria-hidden="true" className={`pointer-events-none absolute -right-14 -top-16 size-40 rounded-full blur-3xl ${plan.is_recommended ? "bg-violet-200/60" : "bg-indigo-100/60"}`} />
            <div className="relative flex items-start justify-between gap-2"><div className="flex items-center gap-2.5"><span className={`grid size-9 place-items-center rounded-xl ${plan.is_recommended ? "bg-violet-700 text-white" : "bg-indigo-50 text-indigo-700"}`}><Building2 size={17} /></span><span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-violet-700">BizBook plan</span></div>{plan.is_recommended && <span className="rounded-full bg-violet-800 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-white shadow-sm">Most popular</span>}</div>
            <h2 className="relative mt-4 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-[28px]">{plan.name}</h2>
            <p className="relative mt-2 min-h-10 text-sm leading-5 text-slate-600">{plan.description || "The complete BizBook toolkit for your institute."}</p>
            <div className={`relative mt-5 rounded-2xl border p-4 ${plan.is_recommended ? "border-violet-200 bg-violet-100/70" : "border-slate-100 bg-slate-50"}`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-3xl font-black tracking-tight tabular-nums text-slate-950">{money.format(amount)}</span><span className="text-sm font-medium text-slate-600">/ {period}</span>{typeof compare === "number" && compare > amount && <span className="text-xs font-bold text-rose-600 line-through">{money.format(compare)}</span>}</div>
              <p className="mt-1.5 text-xs font-semibold text-violet-800">Billed every {days} service days · {cycle === "annual" ? "one yearly payment" : "one monthly payment"}</p>
              <div className="mt-3 border-t border-violet-200/70 pt-2.5 text-[11px] text-slate-600">{cycle === "annual" ? "Yearly billing" : "Monthly billing"} · {plan.availability_status === "available" ? "Available now" : plan.availability_status === "upcoming" ? "Opens soon" : "Signup closed"}</div>
            </div>
            {(plan.available_from || plan.available_until) && <p className="relative mt-3 rounded-xl border border-slate-100 bg-white px-3 py-2 text-[10px] leading-4 text-slate-600">{plan.available_from ? `From ${date(plan.available_from)}` : "Available now"}{plan.available_until ? ` · through ${date(plan.available_until)}` : " · no end date"}</p>}
            {plan.availability_status === "upcoming" && <p className="relative mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Signup opens {plan.available_from ? date(plan.available_from) : "soon"}.</p>}
            {plan.availability_status === "expired" && <p className="relative mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">Signup for this plan has closed.</p>}
            <div className="relative mt-4 grid grid-cols-3 gap-2 text-center">
              {[["Students", plan.student_limit], ["Staff", plan.staff_limit], ["Branches", plan.branch_limit]].map(([label, limit]) => <div key={String(label)} className="rounded-xl border border-slate-100 bg-white px-2 py-2.5"><p className="text-[9px] font-semibold text-slate-500">{label}</p><p className="mt-0.5 text-xs font-extrabold text-slate-900">{limit == null ? "Unlimited" : Number(limit).toLocaleString("en-IN")}</p></div>)}
            </div>
            <ul className="relative mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-700">{visibleFeatures.length ? visibleFeatures.map((feature) => <li key={feature} className="flex min-w-0 items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-violet-600" /><span>{feature}</span></li>) : <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-violet-600" />Complete BizBook workspace</li>}</ul>
            {features.length > 5 && <button type="button" onClick={() => setExpandedPlans((current) => expanded ? current.filter((id) => id !== plan.id) : [...current, plan.id])} aria-expanded={expanded} className="relative mt-3 inline-flex min-h-8 w-fit items-center gap-1.5 rounded-full border border-violet-100 bg-violet-50 px-3 text-[11px] font-bold text-violet-800 transition hover:bg-violet-100">{expanded ? "View less" : "View more"}<ChevronDown size={13} className={`transition ${expanded ? "rotate-180" : ""}`} /></button>}
            <div className="relative mt-auto pt-5">{plan.can_purchase ? <Link href={href} className={`inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-extrabold text-white shadow-md transition hover:brightness-105 ${plan.is_recommended ? "bg-gradient-to-r from-violet-700 to-indigo-700 shadow-violet-200" : "bg-gradient-to-r from-slate-900 to-violet-950 shadow-slate-200"}`}>GO</Link> : <button type="button" disabled className="min-h-11 w-full rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-400">{plan.availability_status === "upcoming" ? "Signup opens soon" : "Plan unavailable"}</button>}
              <p className="mt-2 text-center text-[10px] text-slate-500"><BadgeCheck size={12} className="mr-1 inline text-violet-600" />Sign in to manage a subscription</p></div>
          </article>;
        })}</div>}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8"><div className="rounded-[28px] border border-violet-100 bg-white/90 p-5 shadow-sm sm:p-8"><div className="flex items-end justify-between gap-3 border-b border-slate-100 pb-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.17em] text-violet-700">Included in every plan</p><h2 className="mt-1 text-xl font-extrabold text-slate-950">Your institute toolkit</h2></div><span className="hidden size-10 place-items-center rounded-xl bg-violet-50 text-violet-700 sm:grid"><Check size={19} /></span></div><ul className="mt-2 grid gap-x-6 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">{included.map(({ icon: Icon, title, detail }) => <li key={title} className="flex gap-3.5 py-3.5 sm:py-4"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><Icon size={17} /></span><span><strong className="block text-sm font-extrabold text-slate-900">{title}</strong><span className="mt-1 block text-xs leading-5 text-slate-600">{detail}</span></span></li>)}</ul></div></section>
      <footer className="border-t border-violet-100 bg-white/60 px-4 py-6 text-center text-xs text-slate-500">Prices and plan availability are managed by BizBook.</footer>
    </main>
  );
}
