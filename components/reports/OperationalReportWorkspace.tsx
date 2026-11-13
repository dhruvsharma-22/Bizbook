"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, BarChart3, Minus, RefreshCw, TrendingUp } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { dateInTimeZone, monthInTimeZone } from "@/lib/business-date";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  buildCollectionForecast,
  buildMonthlyLedgerSummaries,
  monthRange,
  type ActivitySummaryInput,
  type CollectionForecast,
  type InstallmentForecastInput,
  type MonthlyLedgerSummary,
} from "@/lib/supabase/operational-reports";
import { isAuthorizedTestProjectConfigured } from "@/lib/supabase/workspace-scope";

type ReportMode = "revenue-expenses" | "comparison" | "collection-forecast";
type Props = { mode: ReportMode };
type ReportResult = { key: string; months?: MonthlyLedgerSummary[]; forecast?: CollectionForecast; today?: string };

const labels = {
  feeReceiptsPaise: "Student fee receipts",
  advanceReceiptsPaise: "Advance receipts",
  completedRefundsPaise: "Completed refunds",
  payrollPaise: "Payroll paid",
  businessExpensesPaise: "Business expenses",
  collectedRevenuePaise: "Net collected revenue",
  totalExpensesPaise: "Total expenses",
  netPaise: "Net operating result",
} as const;
type LedgerField = keyof typeof labels;
const comparisonFields: LedgerField[] = [
  "feeReceiptsPaise", "advanceReceiptsPaise", "completedRefundsPaise", "payrollPaise",
  "businessExpensesPaise", "collectedRevenuePaise", "totalExpensesPaise", "netPaise",
];

function previousMonth(month: string): string {
  const [year, value] = month.split("-").map(Number);
  const index = year * 12 + value - 2;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, amount: number): string {
  const [year, value] = month.split("-").map(Number);
  const index = year * 12 + value - 1 + amount;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function formatMoney(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 2,
  }).format(paise / 100);
}

function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function Metric({ label, value, note, tone = "violet" }: { label: string; value: string; note?: string; tone?: "violet" | "emerald" | "rose" | "slate" }) {
  const tones = {
    violet: { card: "border-t-violet-500 bg-violet-50/45", value: "text-violet-800" },
    emerald: { card: "border-t-emerald-500 bg-emerald-50/45", value: "text-emerald-800" },
    rose: { card: "border-t-rose-500 bg-rose-50/45", value: "text-rose-800" },
    slate: { card: "border-t-slate-400 bg-slate-50", value: "text-slate-900" },
  };
  return <article className={`min-w-0 rounded-2xl border border-slate-200 border-t-[3px] bg-white p-4 shadow-sm ${tones[tone].card}`}>
    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
    <p className={`mt-1.5 break-words text-lg font-extrabold tracking-tight sm:text-xl ${tones[tone].value}`}>{value}</p>
    {note && <p className="mt-1 text-[11px] leading-4 text-slate-500">{note}</p>}
  </article>;
}

export default function OperationalReportWorkspace({ mode }: Props) {
  const workspace = useWorkspaceScope();
  const projectAllowed = isAuthorizedTestProjectConfigured();
  const selection = workspace.selection;
  const institute = selection ? workspace.institutes.find((item) => item.id === selection.instituteId) : undefined;
  const branch = selection?.branchId ? workspace.branches.find((item) => item.id === selection.branchId)?.name : undefined;
  const [endMonth, setEndMonth] = useState("");
  const [comparisonMonth, setComparisonMonth] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  const reportMonths = useMemo(() => {
    if (mode === "revenue-expenses") return monthRange(shiftMonth(endMonth, -5), endMonth);
    if (mode === "comparison") return [comparisonMonth, endMonth].filter(Boolean).sort();
    return [];
  }, [comparisonMonth, endMonth, mode]);

  const requestKey = [mode, selection?.userId ?? "", selection?.instituteId ?? "", selection?.branchId ?? "", endMonth, comparisonMonth].join("|");
  const currentResult = result?.key === requestKey ? result : null;
  const currentError = error?.key === requestKey ? error.message : "";

  useEffect(() => {
    if (!institute || endMonth) return;
    void Promise.resolve().then(() => {
      const current = monthInTimeZone(new Date(), institute.timeZone);
      setEndMonth(current);
      if (mode === "comparison") setComparisonMonth(previousMonth(current));
    });
  }, [endMonth, institute, mode]);

  useEffect(() => {
    let active = true;
    if (!projectAllowed || workspace.loading || !selection || !institute) return;
    if (mode !== "collection-forecast" && (!endMonth || (mode === "comparison" && !comparisonMonth))) return;
    if (mode === "comparison" && comparisonMonth === endMonth) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setError({ key: requestKey, message: "Choose two different months to compare." });
        setLoading(false);
      });
      return () => { active = false; };
    }

    void Promise.resolve().then(() => {
      if (active) {
        setLoading(true);
        setError(null);
      }
    });

    const supabase = createSupabaseBrowserClient();
    const load = async () => {
      try {
        if (mode === "collection-forecast") {
          const today = dateInTimeZone(new Date(), institute.timeZone);
          const horizon = new Date(`${today}T12:00:00.000Z`);
          horizon.setUTCDate(horizon.getUTCDate() + 90);
          const horizonDate = horizon.toISOString().slice(0, 10);
          const rows: InstallmentForecastInput[] = [];
          const pageSize = 1000;
          for (const includeUndated of [false, true]) {
            for (let offset = 0; ; offset += pageSize) {
              let query = supabase.from("installment_balances")
                .select("due_date, outstanding_amount, balance_status")
                .eq("institute_id", selection.instituteId)
                .gt("outstanding_amount", 0)
                .order("due_date", { ascending: true })
                .range(offset, offset + pageSize - 1);
              query = includeUndated ? query.is("due_date", null) : query.lte("due_date", horizonDate);
              if (selection.branchId) query = query.eq("branch_id", selection.branchId);
              const { data, error: queryError } = await query;
              if (queryError) throw new Error("Collection forecast could not be loaded. Confirm your branch access and database connection.");
              rows.push(...(data ?? []));
              if (!data || data.length < pageSize) break;
            }
          }
          const forecast = buildCollectionForecast(rows, today);
          if (active) setResult({ key: requestKey, forecast, today });
          return;
        }

        const months = reportMonths;
        if (!months.length || (mode === "comparison" && months.length !== 2)) {
          throw new Error("Choose a valid month range.");
        }
        let query = supabase.from("financial_activity_summary")
          .select("activity_month, category, direction, amount_total")
          .eq("institute_id", selection.instituteId)
          .in("activity_month", months.map((month) => `${month}-01`));
        if (selection.branchId) query = query.eq("branch_id", selection.branchId);
        const { data, error: queryError } = await query;
        if (queryError) throw new Error("Financial comparison could not be loaded. Confirm your branch access and summary view migration.");
        const summaries = buildMonthlyLedgerSummaries((data ?? []) as ActivitySummaryInput[], months);
        if (active) setResult({ key: requestKey, months: summaries });
      } catch (cause) {
        if (active) setError({
          key: requestKey,
          message: cause instanceof Error ? cause.message : "The report could not be loaded.",
        });
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [comparisonMonth, endMonth, institute, mode, projectAllowed, reportMonths, requestKey, retry, selection, workspace.loading]);

  const description = mode === "revenue-expenses"
    ? "Six months of actual receipts and recorded expenses from the canonical financial ledger."
    : mode === "comparison"
      ? "Compare two months using actual fee and advance receipts, completed refunds, payroll and expenses."
      : "Open installment balances grouped by due date and the institute's business calendar.";

  const updateMonth = (value: string) => {
    setEndMonth(value);
    if (mode === "comparison" && comparisonMonth === endMonth) setComparisonMonth(previousMonth(value));
  };

  return <WorkspaceLayout>
    <main className="min-h-screen bg-[#f5f5f7]">
      <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <header className="relative isolate overflow-hidden rounded-[18px] bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#86198f] px-4 py-3 text-white shadow-lg shadow-purple-900/15 sm:rounded-3xl sm:px-5 sm:py-4">
        <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-24 size-52 rounded-full border border-white/10 bg-white/[0.035]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-20 size-40 rounded-full border border-white/10" />
        <div className="relative z-10 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-1 grid size-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-cyan-100 shadow-inner sm:size-10">
              {mode === "comparison" ? <ArrowLeftRight size={19} /> : mode === "revenue-expenses" ? <BarChart3 size={19} /> : <TrendingUp size={19} />}
            </span>
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-violet-100"><span className="size-2 rounded-full bg-emerald-300" />BIZBOOK · ACCOUNTS</p>
              <h1 className="mt-1.5 text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">
                {mode === "revenue-expenses" ? <><span className="text-white">Revenue &amp;</span>{" "}<span className="bg-gradient-to-r from-amber-200 via-pink-200 to-cyan-200 bg-clip-text text-transparent">Expenses</span></>
                  : mode === "comparison" ? <><span className="text-white">Period</span>{" "}<span className="bg-gradient-to-r from-amber-200 via-pink-200 to-cyan-200 bg-clip-text text-transparent">Comparison</span></>
                    : <><span className="text-white">Collection</span>{" "}<span className="bg-gradient-to-r from-amber-200 via-pink-200 to-cyan-200 bg-clip-text text-transparent">Forecast</span></>}
              </h1>
              <p className="mt-1 max-w-xl text-xs leading-5 text-violet-100 sm:text-sm">{description}</p>
            </div>
          </div>

          {mode === "collection-forecast" ? (
            <button type="button" onClick={() => setRetry((value) => value + 1)} disabled={loading || !selection} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-white/20 disabled:opacity-50 lg:self-center"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
          ) : (
            <div className={`relative z-10 grid w-full gap-2 sm:w-auto ${mode === "comparison" ? "grid-cols-1 min-[420px]:grid-cols-2 sm:min-w-[360px] sm:grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto] sm:min-w-[250px]"}`}>
              {mode === "comparison" && <label className="min-w-0 rounded-xl border border-white/20 bg-white/10 p-2 backdrop-blur-sm">
                <span className="block text-[9px] font-bold uppercase tracking-[0.13em] text-violet-100">Compare month</span>
                <input className="mt-1 block min-h-8 w-full min-w-0 rounded-lg border border-white/20 bg-white px-2 py-1 text-xs font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-violet-200" type="month" value={comparisonMonth} onChange={(event) => setComparisonMonth(event.target.value)} disabled={!selection || loading} />
              </label>}
              <label className="min-w-0 rounded-xl border border-white/20 bg-white/10 p-2 backdrop-blur-sm">
                <span className="block text-[9px] font-bold uppercase tracking-[0.13em] text-violet-100">{mode === "comparison" ? "Against month" : "Latest month"}</span>
                <input className="mt-1 block min-h-8 w-full min-w-0 rounded-lg border border-white/20 bg-white px-2 py-1 text-xs font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-violet-200" type="month" value={endMonth} onChange={(event) => updateMonth(event.target.value)} disabled={!selection || loading} />
              </label>
              <button type="button" onClick={() => setRetry((value) => value + 1)} disabled={loading || !selection} className="col-span-1 inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-white/20 disabled:opacity-50 min-[420px]:col-span-2 sm:col-span-1 sm:self-end"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
            </div>
          )}
        </div>
        <div className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-2.5 text-[10px] sm:text-[11px]">
          <p className="text-violet-100">{mode === "collection-forecast" ? <>Forecast start: <strong className="font-semibold text-white">{currentResult?.today ?? "Current business date"}</strong></> : mode === "comparison" ? <>Comparing: <strong className="font-semibold text-white">{comparisonMonth ? monthLabel(comparisonMonth) : "Choose a month"}</strong> <span className="px-1 text-violet-200">with</span> <strong className="font-semibold text-white">{endMonth ? monthLabel(endMonth) : "Choose a month"}</strong></> : <>Reporting period ends: <strong className="font-semibold text-white">{endMonth ? monthLabel(endMonth) : "Choose a month"}</strong></>}</p>
          <span className="max-w-full truncate rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-violet-50">{institute?.name ?? "Institute workspace"}{branch ? ` · ${branch}` : ""}</span>
        </div>
      </header>

      {!projectAllowed && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Reports are disabled unless this workspace targets the authorized test project.</div>}
      {workspace.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{workspace.error}</div>}
      {projectAllowed && !workspace.loading && !workspace.error && !selection && <div role="status" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No active institute membership is available for this account.</div>}

      {loading && <div className="flex min-h-12 items-center justify-center gap-2.5" role="status" aria-label="Loading report">
        <span className="size-3 rounded-full bg-emerald-500 motion-safe:animate-bounce" />
        <span className="size-3 rounded-full bg-teal-500 motion-safe:animate-bounce [animation-delay:120ms]" />
        <span className="size-3 rounded-full bg-violet-500 motion-safe:animate-bounce [animation-delay:240ms]" />
      </div>}
      {currentError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800 shadow-sm">{currentError}</div>}

      {currentResult?.months && mode === "revenue-expenses" && <MonthlyTrend months={currentResult.months} />}
      {currentResult?.months && mode === "comparison" && <MonthlyComparison months={currentResult.months} fields={comparisonFields} />}
      {currentResult?.forecast && <ForecastPanel forecast={currentResult.forecast} today={currentResult.today ?? ""} />}
      </div>
    </main>
  </WorkspaceLayout>;
}

function MonthlyTrend({ months }: { months: MonthlyLedgerSummary[] }) {
  const rows = months.map((item) => ({
    month: item.month,
    revenue: item.collectedRevenuePaise,
    expenses: item.totalExpensesPaise,
    net: item.netPaise,
  }));
  const isEmpty = rows.every((row) => row.revenue === 0 && row.expenses === 0);
  const totals = rows.reduce((sum, row) => ({ revenue: sum.revenue + row.revenue, expenses: sum.expenses + row.expenses, net: sum.net + row.net }), { revenue: 0, expenses: 0, net: 0 });
  const scale = Math.max(1, ...rows.flatMap((row) => [row.revenue, row.expenses]));
  const resultTone = totals.net < 0 ? "rose" : "emerald";
  return <>
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Six-month financial totals">
      <Metric label="Net collected revenue" value={formatMoney(totals.revenue)} note="Total receipts after completed refunds" tone="emerald" />
      <Metric label="Operating expenses" value={formatMoney(totals.expenses)} note="Payroll and paid business expenses" tone="rose" />
      <Metric label="Net operating result" value={formatMoney(totals.net)} note="Revenue less operating expenses" tone={resultTone} />
    </section>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="revenue-trend-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-indigo-50 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-violet-100 text-violet-800"><BarChart3 size={19} /></span>
          <div><h2 id="revenue-trend-heading" className="text-sm font-extrabold text-slate-900 sm:text-base">Six-month revenue &amp; expenditure</h2><p className="mt-0.5 text-xs text-slate-500">Month-by-month view of collected revenue and paid costs.</p></div>
        </div>
        <span className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">{months.length} periods</span>
      </div>
      {isEmpty && <p className="mx-4 mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 sm:mx-5">No recorded financial activity was found for these months.</p>}
      <div className="divide-y divide-slate-100 px-4 sm:px-5">
        {rows.map((row) => <article key={row.month} className="py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-slate-800">{monthLabel(row.month)}</h3>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums ${row.net >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>Net {formatMoney(row.net)}</span>
          </div>
          <div className="space-y-2.5">
            <div className="grid grid-cols-[62px_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[88px_minmax(0,1fr)_120px] sm:gap-3">
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Revenue</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-emerald-50"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width]" style={{ width: `${Math.max(0, Math.min(100, (row.revenue / scale) * 100))}%` }} /></div>
              <span className="text-right text-xs font-bold tabular-nums text-emerald-800">{formatMoney(row.revenue)}</span>
            </div>
            <div className="grid grid-cols-[62px_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[88px_minmax(0,1fr)_120px] sm:gap-3">
              <span className="text-[10px] font-bold uppercase tracking-wide text-rose-700">Expenses</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-rose-50"><div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-orange-400 transition-[width]" style={{ width: `${Math.max(0, Math.min(100, (row.expenses / scale) * 100))}%` }} /></div>
              <span className="text-right text-xs font-bold tabular-nums text-rose-800">{formatMoney(row.expenses)}</span>
            </div>
          </div>
        </article>)}
      </div>
      {months.some((month) => month.invalidRows > 0) && <p className="border-t border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 sm:px-5">Some malformed amounts were excluded; check the source ledger before relying on this comparison.</p>}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-[10px] font-semibold text-slate-500 sm:px-5"><span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" />Net collected revenue</span><span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-rose-500" />Paid expenses</span><span className="text-slate-400">Bars are scaled to the largest monthly amount in this period.</span></div>
    </section>
  </>;
}

function MonthlyComparison({ months, fields }: { months: MonthlyLedgerSummary[]; fields: LedgerField[] }) {
  if (months.length !== 2) return <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Choose two different months to compare.</div>;
  const [older, newer] = months;
  const costFields: LedgerField[] = ["completedRefundsPaise", "payrollPaise", "businessExpensesPaise", "totalExpensesPaise"];
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="comparison-details-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-indigo-50 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-indigo-100 text-indigo-800"><ArrowLeftRight size={19} /></span><div><h2 id="comparison-details-heading" className="text-sm font-extrabold text-slate-900 sm:text-base">Period comparison</h2><p className="mt-0.5 text-xs text-slate-500">Change is the later month minus the earlier month; higher costs are marked red.</p></div></div>
        <span className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-indigo-800">{monthLabel(older.month)} <span className="px-1 text-indigo-300">→</span> {monthLabel(newer.month)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3.5">Account head</th><th className="px-4 py-3.5 text-right">{monthLabel(older.month)}</th><th className="px-4 py-3.5 text-right">{monthLabel(newer.month)}</th><th className="px-4 py-3.5 text-right">Change</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{fields.map((field) => {
            const delta = newer[field] - older[field];
            const cost = costFields.includes(field);
            const isFavorable = delta === 0 ? null : cost ? delta < 0 : delta > 0;
            const color = isFavorable === null ? "border-slate-200 bg-slate-50 text-slate-600" : isFavorable ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800";
            const ChangeIcon = delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
            const summary = field === "collectedRevenuePaise" || field === "totalExpensesPaise" || field === "netPaise";
            return <tr key={field} className={`transition-colors hover:bg-violet-50/40 ${summary ? "bg-slate-50/70" : "bg-white"}`}>
              <td className={`px-4 py-3.5 ${summary ? "font-extrabold text-slate-900" : "font-semibold text-slate-700"}`}>{labels[field]}</td>
              <td className="px-4 py-3.5 text-right tabular-nums text-slate-600">{formatMoney(older[field])}</td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-slate-900">{formatMoney(newer[field])}</td>
              <td className="px-4 py-3.5 text-right"><span className={`inline-flex items-center justify-end gap-1 rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums ${color}`}><ChangeIcon size={13} />{delta > 0 ? "+" : ""}{formatMoney(delta)}</span></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {months.some((month) => month.invalidRows > 0) && <p className="border-t border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 sm:px-5">Some malformed amounts were excluded; check the source ledger before relying on this comparison.</p>}
      {older.netPaise === 0 && newer.netPaise === 0 && <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">No recorded financial activity exists in either selected month.</p>}
    </section>;
}

function ForecastPanel({ forecast, today }: { forecast: CollectionForecast; today: string }) {
  const rows = [
    { label: "Overdue or due today", shortLabel: "Overdue / today", data: forecast.overdue },
    { label: "Due in 1–7 days", shortLabel: "1–7 days", data: forecast.dueIn1To7Days },
    { label: "Due in 8–30 days", shortLabel: "8–30 days", data: forecast.dueIn8To30Days },
    { label: "Due in 31–60 days", shortLabel: "31–60 days", data: forecast.dueIn31To60Days },
    { label: "Due in 61–90 days", shortLabel: "61–90 days", data: forecast.dueIn61To90Days },
  ];
  const noDueDates = forecast.dueDateMissing.installmentCount > 0;
  const noScheduled = rows.every((row) => row.data.installmentCount === 0);
  const datedTotalPaise = rows.reduce((sum, row) => sum + row.data.amountPaise, 0);
  const datedCount = rows.reduce((sum, row) => sum + row.data.installmentCount, 0);
  const totalOpenPaise = datedTotalPaise + forecast.dueDateMissing.amountPaise;
  const maxAmount = Math.max(1, ...rows.map((row) => row.data.amountPaise));
  const heatColors = ["bg-purple-900", "bg-purple-700", "bg-purple-600", "bg-violet-400", "bg-violet-200"];
  return <>
    <p className="mt-3 text-xs text-slate-500">Balances as of {today}. Only pending, partially paid, and overdue installment balances are included. This is a due-date view, not a prediction of actual collections.</p>
    {noScheduled && !noDueDates && <div className="mt-4 rounded-2xl border border-violet-100 bg-white p-5 text-sm text-slate-600">No open installments are due within this 90-day window.</div>}

    <section className="mt-4 overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
      <div className="border-b border-violet-100 bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#86198f] px-4 py-3 text-white sm:px-5"><h2 className="text-sm font-bold">Collection intensity heat map</h2><p className="mt-0.5 text-[11px] text-violet-100">Darker purple indicates a larger outstanding amount in that due-date period.</p></div>
      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-5 sm:p-4">
        {rows.map((row, index) => {
          const intensity = row.data.amountPaise === 0 ? "bg-violet-50 text-violet-400" : heatColors[Math.min(4, Math.max(0, Math.ceil((row.data.amountPaise / maxAmount) * 4) - 1))] + " text-white";
          return <div key={row.label} className={`min-w-0 rounded-xl border border-violet-100 p-3 ${intensity}`} title={`${row.label}: ${formatMoney(row.data.amountPaise)}`}>
            <p className={`text-[11px] font-semibold ${row.data.amountPaise === 0 ? "text-violet-600" : "text-white/90"}`}>{row.shortLabel}</p>
            <p className="mt-2 break-words text-sm font-extrabold tabular-nums">{formatMoney(row.data.amountPaise)}</p>
            <p className={`mt-1 text-[10px] ${row.data.amountPaise === 0 ? "text-violet-500" : "text-white/80"}`}>{row.data.installmentCount} installments</p>
          </div>;
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 text-[10px] text-slate-500"><span>Lower balance</span>{["bg-violet-50 border-violet-100", "bg-violet-200", "bg-violet-400", "bg-purple-600", "bg-purple-900"].map((color) => <span key={color} className={`size-3 rounded-sm border ${color}`} />)}<span>Higher balance</span></div>
    </section>

    <section className="mt-4 overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
      <div className="border-b border-violet-100 px-4 py-4 sm:px-5"><div className="flex items-center gap-2"><span className="rounded-lg bg-violet-100 p-2 text-violet-800"><TrendingUp size={17} /></span><div><h2 className="text-sm font-bold text-slate-900">90-day collection forecast</h2><p className="mt-0.5 text-xs text-slate-500">Outstanding installment balance grouped by due period.</p></div></div></div>
      <div className="space-y-4 p-4 sm:p-5">
        {rows.map((row) => <div key={row.label} className="grid gap-2 sm:grid-cols-[145px_minmax(0,1fr)_130px] sm:items-center sm:gap-4"><div><p className="text-xs font-semibold text-slate-700">{row.label}</p><p className="text-[10px] text-slate-400">{row.data.installmentCount} installments</p></div><div className="h-3 overflow-hidden rounded-full bg-violet-50"><div className="h-full rounded-full bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#a855f7] transition-all" style={{ width: `${Math.max(0, Math.min(100, (row.data.amountPaise / maxAmount) * 100))}%` }} /></div><p className="text-right text-xs font-bold tabular-nums text-violet-800">{formatMoney(row.data.amountPaise)}</p></div>)}
        {noDueDates && <div className="rounded-lg border border-dashed border-violet-200 bg-violet-50/60 px-3 py-2 text-xs text-violet-800">Undated balance: {formatMoney(forecast.dueDateMissing.amountPaise)} across {forecast.dueDateMissing.installmentCount} installments. Not plotted in the dated periods.</div>}
      </div>
    </section>

    <section className="mt-4 overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
      <div className="bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#86198f] px-4 py-3 text-white sm:px-5"><h2 className="text-sm font-bold">Collection forecast statement</h2><p className="mt-0.5 text-[11px] text-violet-100">Full-width summary of open installment balances by due date.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="bg-violet-50/70 text-[10px] uppercase tracking-wide text-violet-700"><tr><th className="px-4 py-3 text-left">Particulars</th><th className="px-4 py-3 text-right">Open installments</th><th className="px-4 py-3 text-right">Outstanding amount</th></tr></thead>
        <tbody className="divide-y divide-violet-50">{rows.map((row) => <tr key={row.label} className="hover:bg-violet-50/40"><td className="px-4 py-3 font-medium text-slate-700">{row.label}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{row.data.installmentCount}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-violet-800">{formatMoney(row.data.amountPaise)}</td></tr>)}
          {noDueDates && <tr className="bg-violet-50/40"><td className="px-4 py-3 font-medium text-slate-700">Open balance without a due date</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{forecast.dueDateMissing.installmentCount}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-violet-800">{formatMoney(forecast.dueDateMissing.amountPaise)}</td></tr>}
          <tr className="border-t-2 border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50"><td className="px-4 py-3 font-extrabold text-slate-900">Total open balance</td><td className="px-4 py-3 text-right font-extrabold tabular-nums text-slate-900">{datedCount + forecast.dueDateMissing.installmentCount}</td><td className="px-4 py-3 text-right text-base font-extrabold tabular-nums text-violet-900">{formatMoney(totalOpenPaise)}</td></tr>
        </tbody></table></div>
      <div className="border-t border-slate-100 px-4 py-3 text-[11px] leading-5 text-slate-500">This statement summarizes outstanding installment balances by due date; it does not guarantee future receipts. Amounts come from the authorized installment balance view.</div>
    </section>
    {forecast.excludedInvalidRows > 0 && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{forecast.excludedInvalidRows} malformed or zero-balance rows were excluded from the forecast.</div>}
  </>;
}
