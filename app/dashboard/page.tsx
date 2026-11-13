"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  LoaderCircle,
  TrendingUp,
  Users,
  Wallet,
  ReceiptText,
  Activity,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LabelList,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  buildExpenseObligationSummary,
  buildDashboardFinancialSummary,
  formatDashboardCurrency,
  type DashboardFinancialSummary,
  type ExpenseObligationSummary,
} from "@/lib/supabase/dashboard-summary";

type InstituteOption = { id: string; name: string; timeZone: string; accessScope: "institute" | "branches" };
type DashboardActivityRow = {
  activity_month: string;
  category: string;
  direction: string;
  amount_total: number | string;
};
type DashboardTrendPoint = {
  month: string;
  period: string;
  netCollections: number;
  cashOutflow: number;
  netCashFlow: number;
  feeReceipts: number;
  advanceReceipts: number;
};

function getTrailingMonths(selectedMonth: string, count = 6) {
  const [year, month] = selectedMonth.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return [];
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - count + index, 1));
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return {
      key: monthKey,
      month: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(date),
      period: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(date),
    };
  });
}

function buildDashboardTrend(rows: DashboardActivityRow[], selectedMonth: string): DashboardTrendPoint[] {
  const rowsByMonth = new Map<string, DashboardActivityRow[]>();
  for (const row of rows) {
    const key = row.activity_month.slice(0, 7);
    rowsByMonth.set(key, [...(rowsByMonth.get(key) ?? []), row]);
  }

  return getTrailingMonths(selectedMonth).map((month) => {
    const totals = buildDashboardFinancialSummary(rowsByMonth.get(month.key) ?? [], []);
    return {
      month: month.month,
      period: month.period,
      netCollections: totals.feeReceipts + totals.advanceReceipts - totals.completedRefunds,
      cashOutflow: totals.payrollOutflow + totals.businessExpenses,
      netCashFlow: totals.feeReceipts + totals.advanceReceipts - totals.completedRefunds - totals.payrollOutflow - totals.businessExpenses,
      feeReceipts: totals.feeReceipts,
      advanceReceipts: totals.advanceReceipts,
    };
  });
}

function formatCompactCurrency(value: number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "₹0";
  if (Math.abs(amount) >= 1_000_000) return `₹${(amount / 1_000_000).toFixed(1)}m`;
  if (Math.abs(amount) >= 1_000) return `₹${(amount / 1_000).toFixed(0)}k`;
  return `₹${amount.toFixed(0)}`;
}

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
);

function instituteMonth(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    if (year && month) return `${year}-${month}`;
  } catch {
    // A bad legacy time-zone string should not prevent the rest of the page
    // from loading; use the browser's current month as a display fallback.
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function DashboardPage() {
  const workspaceScope = useWorkspaceScope();
  const router = useRouter();
  const [accountError, setAccountError] = useState("");
  const [institutes, setInstitutes] = useState<InstituteOption[]>([]);
  const [selectedInstituteId, setSelectedInstituteId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [summaryResult, setSummaryResult] = useState<{
    scope: string;
    summary: DashboardFinancialSummary;
    expenseSummary: ExpenseObligationSummary;
    studentCount: number;
    overdueAmount: number;
    trend: DashboardTrendPoint[];
  } | null>(null);
  const [summaryError, setSummaryError] = useState<{ scope: string; message: string } | null>(null);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!authData.user) {
          router.replace("/login");
          return;
        }

        const { data: memberships, error: membershipError } = await supabase
          .from("user_memberships")
          .select("institute_id, access_scope")
          .eq("user_id", authData.user.id)
          .eq("is_active", true);
        if (membershipError) throw membershipError;
        const instituteIds = [...new Set((memberships ?? []).map((item) => item.institute_id))];
        if (!instituteIds.length) {
          router.replace("/account");
          return;
        }

        const { data: instituteRows, error: instituteError } = await supabase
          .from("coaching_institutes")
          .select("id, business_name, time_zone")
          .in("id", instituteIds)
          .order("business_name");
        if (instituteError) throw instituteError;
        const accessByInstitute = new Map((memberships ?? []).map((item) => [item.institute_id, item.access_scope]));
        const options = (instituteRows ?? []).flatMap((item) => {
          const accessScope = accessByInstitute.get(item.id);
          return accessScope === "institute" || accessScope === "branches"
            ? [{ id: item.id, name: item.business_name, timeZone: item.time_zone, accessScope }]
            : [];
        });
        if (!options.length) {
          router.replace("/account");
          return;
        }
        if (active) {
          setInstitutes(options);
          setSelectedInstituteId(options[0].id);
          setSelectedMonth(instituteMonth(options[0].timeZone));
        }
      } catch {
        if (active) setAccountError("We could not verify your institute access. Refresh or sign in again.");
      }
    })();
    return () => { active = false; };
  }, [router]);

  const selectedInstitute = institutes.find((item) => item.id === selectedInstituteId);
  const workspaceScopePending = workspaceScope.loading || !workspaceScope.selection
    || (selectedInstitute?.accessScope === "branches" && !selectedBranchId)
    || (!!workspaceScope.selection
    && institutes.some((item) => item.id === workspaceScope.selection?.instituteId)
    && (selectedInstituteId !== workspaceScope.selection.instituteId || selectedBranchId !== workspaceScope.selection.branchId));

  useEffect(() => {
    if (!supabaseConfigured || !selectedInstituteId || !selectedMonth) return;
    if (workspaceScopePending) return;
    let active = true;
    const scope = `${selectedInstituteId}|${selectedBranchId}|${selectedMonth}`;
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        let activityQuery = supabase
          .from("financial_activity_summary")
          .select("activity_month, category, direction, amount_total")
          .eq("institute_id", selectedInstituteId)
          .gte("activity_month", `${getTrailingMonths(selectedMonth)[0]?.key ?? selectedMonth}-01`)
          .lte("activity_month", `${selectedMonth}-01`);
        let balanceQuery = supabase
          .from("installment_balance_summary")
          .select("balance_status, installment_count, outstanding_amount_total")
          .eq("institute_id", selectedInstituteId);
        let studentsQuery = supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("institute_id", selectedInstituteId)
          .is("archived_at", null);
        const expenseSummaryQuery = supabase.rpc("expense_dashboard_summary", {
          p_institute_id: selectedInstituteId,
          p_branch_id: selectedBranchId || null,
          p_month_start: `${selectedMonth}-01`,
        });

        if (selectedBranchId) {
          activityQuery = activityQuery.eq("branch_id", selectedBranchId);
          balanceQuery = balanceQuery.eq("branch_id", selectedBranchId);
          studentsQuery = studentsQuery.eq("branch_id", selectedBranchId);
        }

        const [activity, balances, students, expenses] = await Promise.all([
          activityQuery,
          balanceQuery,
          studentsQuery,
          expenseSummaryQuery,
        ]);
        if (activity.error || balances.error || students.error || expenses.error) {
          throw new Error("Dashboard summary views are unavailable.");
        }
        if (!active) return;
        const activityRows = (activity.data ?? []) as DashboardActivityRow[];
        const selectedActivityRows = activityRows.filter((row) => row.activity_month === `${selectedMonth}-01`);
        setSummaryResult({
          scope,
          summary: buildDashboardFinancialSummary(selectedActivityRows, balances.data ?? []),
          expenseSummary: buildExpenseObligationSummary(expenses.data ?? []),
          studentCount: students.count ?? 0,
          overdueAmount: (balances.data ?? [])
            .filter((row) => String(row.balance_status ?? "").toLowerCase().includes("overdue"))
            .reduce((total, row) => total + Number(row.outstanding_amount_total ?? 0), 0),
          trend: buildDashboardTrend(activityRows, selectedMonth),
        });
        setSummaryError(null);
      } catch {
        if (active) setSummaryError({
          scope,
          message: "Dashboard data could not be loaded. Confirm the test database migrations are applied and try again.",
        });
      }
    })();
    return () => { active = false; };
  }, [selectedBranchId, selectedInstituteId, selectedMonth, workspaceScopePending]);
  const currentScope = `${selectedInstituteId}|${selectedBranchId}|${selectedMonth}`;
  const currentResult = !workspaceScopePending && summaryResult?.scope === currentScope ? summaryResult : null;
  const currentError = workspaceScopePending ? "" : summaryError?.scope === currentScope ? summaryError.message : "";
  const loadingSummary = Boolean(
    supabaseConfigured && selectedInstituteId && selectedMonth && (workspaceScopePending || (!currentResult && !currentError)),
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const next = workspaceScope.selection;
      if (!next || !institutes.some((item) => item.id === next.instituteId)) return;
      const instituteChanged = selectedInstituteId !== next.instituteId;
      const institute = institutes.find((item) => item.id === next.instituteId);
      setSelectedInstituteId(next.instituteId);
      setSelectedBranchId(next.branchId);
      if (instituteChanged && institute) setSelectedMonth(instituteMonth(institute.timeZone));
    });
    return () => { active = false; };
  }, [institutes, selectedInstituteId, workspaceScope.selection]);
  const summary = currentResult?.summary;
  const expenseSummary = currentResult?.expenseSummary;
  const studentCount = currentResult?.studentCount;
  const overdueAmount = currentResult?.overdueAmount ?? 0;
  const trend = currentResult?.trend ?? [];
  const hasTrendActivity = trend.some((point) => point.netCollections !== 0 || point.cashOutflow !== 0);
  const receiptMix = [
    { name: "Fee receipts", value: summary?.feeReceipts ?? 0, color: "#0066cc" },
    { name: "Advance receipts", value: summary?.advanceReceipts ?? 0, color: "#7a7a7a" },
  ].filter((item) => item.value > 0);
  const receiptMixTotal = receiptMix.reduce((total, item) => total + item.value, 0);
  const feeReceiptShare = receiptMixTotal > 0 ? ((summary?.feeReceipts ?? 0) / receiptMixTotal) * 100 : 0;
  const advanceReceiptShare = receiptMixTotal > 0 ? ((summary?.advanceReceipts ?? 0) / receiptMixTotal) * 100 : 0;
  const currentTrend = trend.length ? trend[trend.length - 1] : undefined;
  const previousTrend = trend.length > 1 ? trend[trend.length - 2] : undefined;
  const getPercentChange = (current: number | undefined, previous: number | undefined) => {
    if (current === undefined || previous === undefined || previous <= 0) return null;
    return ((current - previous) / previous) * 100;
  };
  const collectionsChange = getPercentChange(currentTrend?.netCollections, previousTrend?.netCollections);
  const outflowChange = getPercentChange(currentTrend?.cashOutflow, previousTrend?.cashOutflow);
  const value = (amount: number | undefined) => amount === undefined ? "—" : formatDashboardCurrency(amount);

  return (
    <WorkspaceLayout>
      <main className="bizbook-dashboard-canvas min-h-screen bg-[#f5f5f7]">
      <section className="mx-auto max-w-[1600px] space-y-6 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <header className="relative isolate overflow-hidden rounded-[18px] bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#86198f] px-4 py-3 text-white sm:rounded-3xl sm:px-5 sm:py-4">
          <div className="pointer-events-none absolute -right-14 -top-24 size-52 rounded-full border border-white/10 bg-white/[0.035]" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-28 right-20 size-40 rounded-full border border-white/10" aria-hidden="true" />
          <div className="relative z-10 flex flex-row items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-violet-100">
                <span className="size-2 rounded-full bg-emerald-300" aria-hidden="true" /> BIZBOOK · ACCOUNTS
              </p>
              <h1 className="mt-1.5 text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">
                <span className="text-white">Dash</span><span className="bg-gradient-to-r from-amber-200 via-pink-200 to-cyan-200 bg-clip-text text-transparent">board</span>
              </h1>
              <p className="mt-1 hidden max-w-xl text-xs leading-5 text-violet-100 sm:block sm:text-sm">
                Collections, operating costs, and student balances from your shared institute ledger.
              </p>
            </div>
            {institutes.length > 0 && (
              <label className="relative z-10 block w-[138px] shrink-0 rounded-[11px] border border-white/20 bg-white/10 p-2 backdrop-blur-sm sm:w-[176px] sm:rounded-[18px] sm:p-2.5">
                <span className="block text-[9px] font-bold uppercase tracking-[0.13em] text-violet-100 sm:text-[10px]">Reporting month</span>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                  className="mt-1.5 block min-h-9 w-full min-w-0 rounded-lg border border-white/20 bg-white px-2 py-1.5 text-xs font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-violet-200 sm:min-h-10 sm:rounded-[11px] sm:px-3 sm:text-sm"
                />
              </label>
            )}
          </div>
          <div className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-2.5 text-[11px] sm:text-xs">
            <p className="text-violet-100">Selected period: <span className="font-bold text-white">{selectedMonth ? new Date(`${selectedMonth}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "—"}</span></p>
            <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-violet-50">Institute dashboard</span>
          </div>
        </header>

        {accountError && <p role="alert" className="mt-4 max-w-xl rounded-[11px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{accountError}</p>}
        {!supabaseConfigured && (
          <p role="status" className="mt-4 rounded-[11px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Shared database metrics are unavailable because Supabase is not configured. Existing browser data is not included in these totals.
          </p>
        )}
        {currentError && <p role="alert" className="mt-4 rounded-[11px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{currentError}</p>}
        {!!(summary?.invalidRows || expenseSummary?.invalidRows) && <p role="alert" className="mt-4 rounded-[11px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{(summary?.invalidRows ?? 0) + (expenseSummary?.invalidRows ?? 0)} malformed financial summary row(s) were excluded. Totals may be incomplete; ask an institute administrator to review the ledger.</p>}

        <section className="relative space-y-5 rounded-[18px] border border-[#e0e0e0] bg-white p-3 shadow-none sm:space-y-6 sm:p-5" aria-label="Cash flow analytics">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-[18px] border border-[#e0e0e0] bg-white px-4 py-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#0066cc]">Financial intelligence</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-[#1d1d1f] sm:text-2xl">Cash flow analytics</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[#6e6e73] sm:text-sm">Follow money coming in, money going out, and the cash position left after operating payments.</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#e0e0e0] bg-white px-3 py-2 text-[11px] font-semibold text-[#515154]">
              <span className="size-2 rounded-full bg-violet-600" /> Six-month view
            </span>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
            <section className="relative min-w-0 overflow-hidden rounded-[18px] border border-[#e0e0e0] bg-white p-4 shadow-none sm:p-6" aria-labelledby="cashflow-trend-heading">

              <div className="relative flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#0066cc]">Inflow vs. outflow</p>
                  <h3 id="cashflow-trend-heading" className="mt-1 text-lg font-semibold tracking-[-0.025em] text-[#1d1d1f] sm:text-xl">Cash movement over time</h3>
                  <p className="mt-1 max-w-xl text-xs leading-5 text-[#6e6e73]">Net collections after completed refunds compared with payroll and paid business expenses.</p>
                </div>
                <span className="grid size-11 shrink-0 place-items-center rounded-[18px] bg-[#f5f5f7] text-[#0066cc] ring-1 ring-violet-300/20"><Activity size={20} aria-hidden="true" /></span>
              </div>
              <div className="relative mt-5 h-[245px] w-full sm:h-[290px]">
                {loadingSummary ? (
                  <div className="grid h-full place-items-center rounded-[18px] bg-[#f5f5f7] text-sm text-[#6e6e73]"><span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" /> Loading cash flow</span></div>
                ) : !currentResult || !hasTrendActivity ? (
                  <div className="grid h-full place-items-center rounded-[18px] border border-dashed border-[#e0e0e0] bg-[#f5f5f7]/80 px-5 text-center text-sm text-[#6e6e73]">
                    {currentError ? "Cash flow is unavailable until the database summary loads." : "No recorded inflows or outflows in this six-month period."}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart data={trend} accessibilityLayer margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="#E5E7EB" strokeOpacity={1} strokeDasharray="4 6" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 11 }} tickMargin={12} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 10 }} tickFormatter={(amount) => formatCompactCurrency(Number(amount))} width={58} />
                      <Tooltip
                        labelFormatter={(label) => String(label)}
                        formatter={(amount, name) => [formatDashboardCurrency(Number(amount ?? 0)), String(name)]}
                        contentStyle={{ background: "#FFFFFF", border: "1px solid #E0E0E0", color: "#1D1D1F", borderRadius: 11, boxShadow: "none", fontSize: 12 }}
                      />
                      <Legend verticalAlign="top" align="right" height={36} iconType="circle" wrapperStyle={{ fontSize: 11, color: "#64748B" }} />
                      <Area type="monotone" dataKey="netCollections" name="Cash inflow" stroke="#0066cc" strokeWidth={3} fill="#0066cc" fillOpacity={0.08} activeDot={{ r: 5, strokeWidth: 0 }} />
                      <Area type="monotone" dataKey="cashOutflow" name="Cash outflow" stroke="#7a7a7a" strokeWidth={2.5} fill="#7a7a7a" fillOpacity={0.05} activeDot={{ r: 5, strokeWidth: 0 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="relative mt-2 grid grid-cols-2 gap-3 border-t border-[#f0f0f0] pt-4">
                <div className="rounded-[18px] border border-[#e0e0e0] bg-[#f5f5f7]/60 p-3">
                  <p className="flex items-center gap-2 text-[11px] font-semibold text-[#0066cc]"><span className="size-2 rounded-full bg-violet-400 " />Cash inflow</p>
                  <p className="mt-1.5 text-lg font-semibold tracking-[-0.025em] text-[#1d1d1f]">{currentTrend ? formatDashboardCurrency(currentTrend.netCollections) : "—"}</p>
                  <p className="mt-0.5 text-[10px] text-[#6e6e73]">Selected month</p>
                </div>
                <div className="rounded-[18px] border border-[#e0e0e0] bg-[#fafafc] p-3">
                  <p className="flex items-center gap-2 text-[11px] font-semibold text-emerald-700"><span className="size-2 rounded-full bg-emerald-400 " />Cash outflow</p>
                  <p className="mt-1.5 text-lg font-semibold tracking-[-0.025em] text-[#1d1d1f]">{currentTrend ? formatDashboardCurrency(currentTrend.cashOutflow) : "—"}</p>
                  <p className="mt-0.5 text-[10px] text-[#6e6e73]">Selected month</p>
                </div>
              </div>
            </section>

            <section className="relative min-w-0 overflow-hidden rounded-[18px] border border-[#e0e0e0] bg-white p-4 shadow-none sm:p-6" aria-labelledby="receipt-mix-heading">


              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#0066cc]">Selected month</p>
                  <h3 id="receipt-mix-heading" className="mt-1 text-lg font-semibold tracking-[-0.025em] text-[#1d1d1f] sm:text-xl">Receipt composition</h3>
                  <p className="mt-1 text-xs leading-5 text-[#515154]">See how fee payments and advance receipts contribute to total receipts.</p>
                </div>
                <span className="grid size-11 shrink-0 place-items-center rounded-[18px] bg-[#f5f5f7] text-[#0066cc] ring-1 ring-sky-200/20"><PieChartIcon size={20} aria-hidden="true" /></span>
              </div>
              <div className="relative mt-3 h-[205px] sm:h-[230px]">
                {loadingSummary ? (
                  <div className="grid h-full place-items-center text-sm text-[#515154]"><span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" /> Loading receipt mix</span></div>
                ) : !currentResult || receiptMixTotal <= 0 ? (
                  <div className="grid h-full place-items-center px-4 text-center text-sm text-[#515154]">
                    {currentError ? "Receipt composition is unavailable until the database summary loads." : "No fee or advance receipts recorded for this month."}
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <PieChart accessibilityLayer>
                        <Pie data={receiptMix} dataKey="value" nameKey="name" innerRadius={62} outerRadius={91} paddingAngle={5} stroke="none" cornerRadius={5}>
                          {receiptMix.map((item) => <Cell key={item.name} fill={item.color}  />)}
                        </Pie>
                        <Tooltip formatter={(amount, name) => [formatDashboardCurrency(Number(amount ?? 0)), String(name)]} contentStyle={{ background: "#FFFFFF", border: "1px solid #E0E0E0", color: "#1D1D1F", borderRadius: 11, boxShadow: "none", fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#515154]">Total receipts</span>
                      <span className="mt-1 text-xl font-semibold tracking-[-0.025em] text-[#1d1d1f]">{formatCompactCurrency(receiptMixTotal)}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="relative grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
                <div className="min-w-0 rounded-[18px] border border-violet-300/20 bg-[#f5f5f7] p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0066cc]"><span className="size-2 rounded-full bg-[#f5f5f7]0" />Fee receipts</div>
                  <p className="mt-1.5 truncate text-sm font-extrabold text-slate-900">{formatDashboardCurrency(summary?.feeReceipts ?? 0)}</p>
                  <p className="mt-0.5 text-[10px] text-[#6e6e73]">{receiptMixTotal > 0 ? `${feeReceiptShare.toFixed(1)}% of receipts` : "No receipts yet"}</p>
                </div>
                <div className="min-w-0 rounded-[18px] border border-sky-300/20 bg-[#f5f5f7] p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700"><span className="size-2 rounded-full bg-amber-500" />Advance receipts</div>
                  <p className="mt-1.5 truncate text-sm font-extrabold text-slate-900">{formatDashboardCurrency(summary?.advanceReceipts ?? 0)}</p>
                  <p className="mt-0.5 text-[10px] text-[#6e6e73]">{receiptMixTotal > 0 ? `${advanceReceiptShare.toFixed(1)}% of receipts` : "No receipts yet"}</p>
                </div>
              </div>
            </section>
          </div>

          <section className="relative isolate overflow-hidden rounded-[18px] border border-[#e0e0e0] bg-white p-4 shadow-none sm:p-6" aria-labelledby="fee-overview-heading">

            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#0066cc]">Fee collection overview</p>
                <h3 id="fee-overview-heading" className="mt-1 text-xl font-semibold tracking-[-0.025em] text-[#1d1d1f] sm:text-2xl">Total fee, received &amp; overdue</h3>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-[#6e6e73] sm:text-sm">
                  A clear snapshot of fee receipts and the amount still overdue for the selected reporting month.
                </p>
              </div>
              <span className="grid size-11 shrink-0 place-items-center rounded-[18px] bg-[#f5f5f7] text-[#0066cc] ring-1 ring-indigo-100">
                <CircleDollarSign size={21} aria-hidden="true" />
              </span>
            </div>

            {/*
              Total fee is calculated from recorded fee receipts plus the outstanding
              installment balance. Overdue is separately derived from balance rows
              whose balance_status contains "overdue".
            */}
            <div className="relative mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-[18px] border border-indigo-100 bg-[#f5f5f7] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[#0066cc]">Total fee tracked</p>
                  <span className="grid size-8 place-items-center rounded-[11px] bg-indigo-100 text-[#0066cc]"><Wallet size={16} /></span>
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-[#1d1d1f]">
                  {summary ? formatDashboardCurrency((summary.feeReceipts ?? 0) + (summary.outstandingBalance ?? 0)) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-[#6e6e73]">Received fee + remaining balance</p>
              </div>
              <div className="rounded-[18px] border border-emerald-100 bg-[#f5f5f7] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-emerald-700">Fee received</p>
                  <span className="grid size-8 place-items-center rounded-[11px] bg-emerald-100 text-emerald-700"><ArrowDownToLine size={16} /></span>
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-[#1d1d1f]">
                  {summary ? formatDashboardCurrency(summary.feeReceipts ?? 0) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-[#6e6e73]">Fee receipts recorded this month</p>
              </div>
              <div className="rounded-[18px] border border-rose-100 bg-[#f5f5f7] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-rose-700">Overdue amount</p>
                  <span className="grid size-8 place-items-center rounded-[11px] bg-rose-100 text-rose-700"><CalendarClock size={16} /></span>
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-[#1d1d1f]">
                  {currentResult ? formatDashboardCurrency(overdueAmount) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-[#6e6e73]">{summary?.overdueInstallmentCount?.toLocaleString("en-IN") ?? "—"} overdue installments</p>
              </div>
            </div>

            <div className="relative mt-6 overflow-hidden rounded-[18px] border border-[#e0e0e0] bg-[#f5f5f7] p-3 sm:p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                <div>
                  <p className="text-sm font-bold text-slate-900">Fee performance</p>
                  <p className="mt-0.5 text-[11px] text-[#6e6e73]">Amounts are displayed above each bar</p>
                </div>
                <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[10px] font-medium text-[#515154]">{selectedMonth || "Selected month"}</span>
              </div>
              <div className="h-[250px] w-full sm:h-[285px]">
                {loadingSummary ? (
                  <div className="grid h-full place-items-center text-sm text-[#6e6e73]">
                    <span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" /> Loading fee overview</span>
                  </div>
                ) : !currentResult ? (
                  <div className="grid h-full place-items-center px-5 text-center text-sm text-[#6e6e73]">
                    {currentError || "Fee overview is unavailable until the database summary loads."}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart
                      data={[{
                        category: "Selected month",
                        totalFee: (summary?.feeReceipts ?? 0) + (summary?.outstandingBalance ?? 0),
                        received: summary?.feeReceipts ?? 0,
                        overdue: overdueAmount,
                      }]}
                      margin={{ top: 38, right: 14, left: 2, bottom: 4 }}
                      barCategoryGap="28%"
                    >
                      <defs>
                        <linearGradient id="dashboard-total-fee-bar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#A5B4FC" />
                          <stop offset="100%" stopColor="#4F46E5" />
                        </linearGradient>
                        <linearGradient id="dashboard-received-bar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6EE7B7" />
                          <stop offset="100%" stopColor="#059669" />
                        </linearGradient>
                        <linearGradient id="dashboard-overdue-bar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FDA4AF" />
                          <stop offset="100%" stopColor="#E11D48" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#273244" strokeDasharray="3 6" />
                      <XAxis dataKey="category" axisLine={false} tickLine={false} tick={{ fill: "#94A3B8", fontSize: 11 }} tickMargin={12} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94A3B8", fontSize: 10 }} tickFormatter={(amount) => formatCompactCurrency(Number(amount))} width={58} />
                      <Tooltip
                        formatter={(amount, name) => [formatDashboardCurrency(Number(amount ?? 0)), String(name)]}
                        contentStyle={{ background: "#FFFFFF", border: "1px solid #E0E0E0", borderRadius: 11, color: "#1D1D1F", boxShadow: "none", fontSize: 12, padding: "10px 12px", opacity: 1 }}
                        labelStyle={{ color: "#1D1D1F", fontWeight: 600, marginBottom: 6 }}
                        itemStyle={{ color: "#333333", fontWeight: 400, paddingTop: 3 }}
                        cursor={{ fill: "rgba(148,163,184,0.08)" }}
                      />
                      <Legend verticalAlign="top" align="right" height={30} iconType="circle" wrapperStyle={{ fontSize: 11, color: "#64748B" }} />
                      <Bar dataKey="totalFee" name="Total fee tracked" fill="url(#dashboard-total-fee-bar)" radius={[8, 8, 2, 2]} maxBarSize={62}>
                        <LabelList dataKey="totalFee" position="top" formatter={(value) => formatDashboardCurrency(Number(value ?? 0))} fill="#3730A3" fontSize={12} fontWeight={800} />
                      </Bar>
                      <Bar dataKey="received" name="Fee received" fill="url(#dashboard-received-bar)" radius={[8, 8, 2, 2]} maxBarSize={62}>
                        <LabelList dataKey="received" position="top" formatter={(value) => formatDashboardCurrency(Number(value ?? 0))} fill="#047857" fontSize={12} fontWeight={800} />
                      </Bar>
                      <Bar dataKey="overdue" name="Overdue amount" fill="url(#dashboard-overdue-bar)" radius={[8, 8, 2, 2]} maxBarSize={62}>
                        <LabelList dataKey="overdue" position="top" formatter={(value) => formatDashboardCurrency(Number(value ?? 0))} fill="#BE123C" fontSize={12} fontWeight={800} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 border-t border-[#e0e0e0] px-1 pt-3 text-[10px] text-[#6e6e73]">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-indigo-400" />Total fee tracked</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-400" />Fee received</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-400" />Overdue amount</span>
              </div>
            </div>
            <p className="relative mt-2 rounded-[11px] bg-[#f5f5f7] px-3 py-2.5 text-[11px] leading-5 text-[#6e6e73]">
              Total fee tracked = recorded fee receipts for the selected month + current outstanding installment balance. Overdue shows only balances classified as overdue by the database summary.
            </p>
          </section>

          <section className="relative isolate overflow-hidden rounded-[18px] border border-[#e0e0e0]/90 bg-white p-4 transition-all duration-200 hover:border-slate-300 hover:shadow-[0_12px_30px_rgba(15,23,42,0.07)] sm:p-6" aria-labelledby="receipt-trend-heading">

            <div className="relative flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#0066cc]">Receipt sources</p>
                <h3 id="receipt-trend-heading" className="mt-1 text-lg font-semibold tracking-[-0.025em] text-[#1d1d1f] sm:text-xl">Monthly fee &amp; advance receipts</h3>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-[#515154]">Compare fee payments and advance receipts over the last six months, with each source shown separately.</p>
              </div>
              <span className="grid size-11 shrink-0 place-items-center rounded-[18px] bg-[#f5f5f7] text-[#0066cc] ring-1 ring-[#e0e0e0]"><CircleDollarSign size={20} aria-hidden="true" /></span>
            </div>
            <div className="relative mt-4 h-[210px] sm:h-[245px]">
              {loadingSummary ? (
                <div className="grid h-full place-items-center rounded-[18px] bg-white/5 text-sm text-[#515154]"><span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" /> Loading receipt sources</span></div>
              ) : !currentResult || !trend.some((point) => point.feeReceipts > 0 || point.advanceReceipts > 0) ? (
                <div className="grid h-full place-items-center rounded-[18px] border border-dashed border-violet-300/30 bg-[#fafafc] px-5 text-center text-sm text-[#515154]">{currentError ? "Receipt source history is unavailable until the database summary loads." : "No fee or advance receipts recorded in this six-month period."}</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={trend} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dashboard-fee-bars" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C4B5FD" /><stop offset="55%" stopColor="#8B5CF6" /><stop offset="100%" stopColor="#6D28D9" /></linearGradient>
                      <linearGradient id="dashboard-advance-bars" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FEF08A" /><stop offset="45%" stopColor="#FACC15" /><stop offset="100%" stopColor="#D97706" /></linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#64748b" strokeOpacity={0.28} strokeDasharray="4 6" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 11 }} tickMargin={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 10 }} tickFormatter={(amount) => formatCompactCurrency(Number(amount))} width={58} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="min-w-[170px] rounded-xl border border-[#e0e0e0] bg-white px-3.5 py-3 text-xs">
                            <p className="mb-2 font-semibold text-[#1d1d1f]">{String(label ?? "")}</p>
                            {payload.map((entry) => {
                              const color = entry.dataKey === "feeReceipts" ? "#6D28D9" : "#B45309";
                              return (
                                <div key={String(entry.dataKey)} className="flex items-center justify-between gap-4 py-1">
                                  <span className="font-semibold" style={{ color }}>{String(entry.name ?? entry.dataKey)}</span>
                                  <span className="font-bold tabular-nums" style={{ color }}>{formatDashboardCurrency(Number(entry.value ?? 0))}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      }}
                      cursor={{ fill: "rgba(148,163,184,0.08)" }}
                    />
                    <Legend verticalAlign="top" align="right" height={32} iconType="circle" wrapperStyle={{ fontSize: 11, color: "#64748B" }} />
                    <Bar dataKey="feeReceipts" name="Fee receipts" stackId="receipts" fill="url(#dashboard-fee-bars)" radius={[0, 0, 0, 0]} maxBarSize={42} />
                    <Bar dataKey="advanceReceipts" name="Advance receipts" stackId="receipts" fill="url(#dashboard-advance-bars)" radius={[7, 7, 0, 0]} maxBarSize={42} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="relative mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-[18px] border border-violet-300/20 bg-[#f5f5f7]/70 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#0066cc]">Fee receipts · selected month</p><p className="mt-1 text-base font-extrabold text-slate-900">{formatCompactCurrency(summary?.feeReceipts ?? 0)}</p></div>
              <div className="relative overflow-hidden rounded-[18px] border border-amber-300/35 bg-[#fafafc] p-3"><div aria-hidden="true" className="pointer-events-none absolute -right-5 -top-7 size-20 rounded-full bg-yellow-300/20 blur-2xl"/><p className="relative text-[10px] font-semibold uppercase tracking-wide text-amber-700">Advance receipts · selected month</p><p className="relative mt-1 text-base font-extrabold text-slate-900">{formatCompactCurrency(summary?.advanceReceipts ?? 0)}</p></div>
              <div className="rounded-[18px] border border-emerald-300/20 bg-[#fafafc] p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Total receipts · selected month</p><p className="mt-1 text-base font-extrabold text-slate-900">{formatCompactCurrency(receiptMixTotal)}</p></div>
            </div>
          </section>

          <section className="relative isolate overflow-hidden rounded-[18px] border border-[#e0e0e0] bg-white p-4 shadow-none sm:p-6" aria-labelledby="net-position-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="relative text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Operating result</p>
                <h3 id="net-position-heading" className="relative mt-1 text-lg font-semibold tracking-[-0.025em] text-[#1d1d1f]">Net cash position by month</h3>
                <p className="relative mt-1 text-xs leading-5 text-[#515154]">Cash inflow minus cash outflow. Positive bars indicate a surplus; negative bars indicate an operating cash deficit.</p>
              </div>
              <span className="relative grid size-11 place-items-center rounded-[18px] bg-emerald-400/15 text-emerald-700 ring-1 ring-emerald-300/25"><Wallet size={20} /></span>
            </div>
            <div className="mt-3 h-[190px] sm:h-[220px]">
              {currentResult && hasTrendActivity ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={trend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#94A3B8" strokeOpacity={0.25} strokeDasharray="4 6" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 11 }} tickMargin={9} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 10 }} tickFormatter={(amount) => formatCompactCurrency(Number(amount))} width={58} />
                    <ReferenceLine y={0} stroke="#CBD5E1" strokeOpacity={0.7} strokeDasharray="4 4" />
                    <Tooltip formatter={(amount) => [formatDashboardCurrency(Number(amount ?? 0)), "Net cash position"]} contentStyle={{ background: "#FFFFFF", border: "1px solid #E0E0E0", borderRadius: 11, color: "#1D1D1F", boxShadow: "none", fontSize: 12, padding: "10px 12px", opacity: 1 }} labelStyle={{ color: "#1D1D1F", fontWeight: 600, marginBottom: 6 }} itemStyle={{ color: "#333333", fontWeight: 400, paddingTop: 3 }} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                    <Bar dataKey="netCashFlow" name="Net cash position" radius={[7, 7, 2, 2]} maxBarSize={48}>{trend.map((point) => <Cell key={point.month} fill={point.netCashFlow >= 0 ? "#34D399" : "#FB7185"} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="grid h-full place-items-center rounded-[18px] border border-dashed border-emerald-300/25 bg-[#fafafc] text-sm text-[#515154]">{loadingSummary ? "Loading net cash position…" : "No net cash position available yet"}</div>}
            </div>
          </section>
        </section>


          <section aria-labelledby="financial-summary-table-heading" className="relative isolate overflow-hidden rounded-[18px] border border-[#e0e0e0] bg-white p-4 shadow-none sm:p-6">


            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-700">Financial overview</p>
                <h2 id="financial-summary-table-heading" className="mt-1 text-xl font-semibold tracking-[-0.025em] text-[#1d1d1f] sm:text-2xl">Workspace summary</h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-[#515154]">All key student, collection, installment and expense figures in one clear view.</p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#e0e0e0] bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#515154]"><span className="size-1.5 rounded-full bg-amber-300" /> Selected month overview</span>
            </div>
            <div className="overflow-x-auto rounded-[18px] border border-[#e0e0e0] bg-white">
              <table className="w-full min-w-[680px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#e0e0e0] bg-[#f5f5f7] text-[10px] uppercase tracking-[0.16em] text-[#6e6e73]">
                    <th scope="col" className="px-4 py-3.5 font-bold sm:px-5">Metric</th>
                    <th scope="col" className="px-4 py-3.5 text-right font-bold sm:px-5">Amount / total</th>
                    <th scope="col" className="px-4 py-3.5 font-bold sm:px-5">Details</th>
                    <th scope="col" className="px-4 py-3.5 text-right font-bold sm:px-5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="group transition-colors hover:bg-[#f5f5f7]">
                    <th scope="row" className="px-4 py-4 font-semibold text-slate-800 sm:px-5"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] border border-blue-300/20 bg-blue-400/10 text-blue-300"><Users size={18}/></span>Active students</span></th>
                    <td className="px-4 py-4 text-right text-lg font-extrabold tabular-nums text-slate-900 sm:px-5">{studentCount === undefined ? "—" : studentCount.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-4 text-xs text-[#515154] sm:px-5">Students in your workspace</td>
                    <td className="px-4 py-4 text-right sm:px-5"><span className="rounded-full border border-blue-300/20 bg-blue-300/10 px-2.5 py-1 text-[10px] font-semibold text-blue-200">Students</span></td>
                  </tr>
                  <tr className="group transition-colors hover:bg-[#f5f5f7]">
                    <th scope="row" className="px-4 py-4 font-semibold text-slate-800 sm:px-5"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] border border-rose-300/20 bg-rose-400/10 text-rose-300"><ArrowDownToLine size={18}/></span>Fee receipts</span></th>
                    <td className="px-4 py-4 text-right text-lg font-extrabold tabular-nums text-rose-700 sm:px-5">{value(summary?.feeReceipts)}</td>
                    <td className="px-4 py-4 text-xs text-[#515154] sm:px-5">Fee payments recorded this month</td>
                    <td className="px-4 py-4 text-right sm:px-5"><span className="rounded-full border border-rose-300/20 bg-rose-300/10 px-2.5 py-1 text-[10px] font-semibold text-rose-700">Received</span></td>
                  </tr>
                  <tr className="group transition-colors hover:bg-[#f5f5f7]">
                    <th scope="row" className="px-4 py-4 font-semibold text-slate-800 sm:px-5"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] border border-amber-300/30 bg-amber-300/10 text-amber-700"><CreditCard size={18}/></span>Advance receipts</span></th>
                    <td className="px-4 py-4 text-right text-lg font-extrabold tabular-nums text-amber-700 sm:px-5">{value(summary?.advanceReceipts)}</td>
                    <td className="px-4 py-4 text-xs text-[#515154] sm:px-5">Advance inflows; later allocations excluded</td>
                    <td className="px-4 py-4 text-right sm:px-5"><span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold text-amber-700">Advance</span></td>
                  </tr>
                  <tr className="group transition-colors hover:bg-[#f5f5f7]">
                    <th scope="row" className="px-4 py-4 font-semibold text-slate-800 sm:px-5"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] border border-orange-300/20 bg-orange-400/10 text-orange-300"><CalendarClock size={18}/></span>Outstanding installments</span></th>
                    <td className="px-4 py-4 text-right text-lg font-extrabold tabular-nums text-orange-200 sm:px-5">{value(summary?.outstandingBalance)}</td>
                    <td className="px-4 py-4 text-xs text-[#515154] sm:px-5">Installment balance still to be collected</td>
                    <td className="px-4 py-4 text-right sm:px-5"><span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-2.5 py-1 text-[10px] font-semibold text-orange-200">{summary?.overdueInstallmentCount?.toLocaleString("en-IN") ?? "—"} overdue</span></td>
                  </tr>
                  <tr className="group transition-colors hover:bg-[#f5f5f7]">
                    <th scope="row" className="px-4 py-4 font-semibold text-slate-800 sm:px-5"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] border border-violet-300/20 bg-[#f5f5f7] text-[#0066cc]"><ArrowUpFromLine size={18}/></span>Completed refunds</span></th>
                    <td className="px-4 py-4 text-right text-lg font-extrabold tabular-nums text-[#0066cc] sm:px-5">{value(summary?.completedRefunds)}</td>
                    <td className="px-4 py-4 text-xs text-[#515154] sm:px-5">Confirmed or completed refunds only</td>
                    <td className="px-4 py-4 text-right sm:px-5"><span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2.5 py-1 text-[10px] font-semibold text-[#0066cc]">Refunds</span></td>
                  </tr>
                  <tr className="group transition-colors hover:bg-[#f5f5f7]">
                    <th scope="row" className="px-4 py-4 font-semibold text-slate-800 sm:px-5"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] border border-blue-300/20 bg-blue-400/10 text-blue-300"><Wallet size={18}/></span>Payroll paid</span></th>
                    <td className="px-4 py-4 text-right text-lg font-extrabold tabular-nums text-blue-200 sm:px-5">{value(summary?.payrollOutflow)}</td>
                    <td className="px-4 py-4 text-xs text-[#515154] sm:px-5">Salary ledger for the selected month</td>
                    <td className="px-4 py-4 text-right sm:px-5"><span className="rounded-full border border-blue-300/20 bg-blue-300/10 px-2.5 py-1 text-[10px] font-semibold text-blue-200">Paid</span></td>
                  </tr>
                  <tr className="group transition-colors hover:bg-[#f5f5f7]">
                    <th scope="row" className="px-4 py-4 font-semibold text-slate-800 sm:px-5"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] border border-emerald-300/20 bg-emerald-400/10 text-emerald-700"><ReceiptText size={18}/></span>Expenses recorded</span></th>
                    <td className="px-4 py-4 text-right text-lg font-extrabold tabular-nums text-emerald-700 sm:px-5">{value(expenseSummary?.recordedMonthTotal)}</td>
                    <td className="px-4 py-4 text-xs text-[#515154] sm:px-5">Paid and unpaid expenses dated this month</td>
                    <td className="px-4 py-4 text-right sm:px-5"><span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">Recorded</span></td>
                  </tr>
                  <tr className="group transition-colors hover:bg-[#f5f5f7]">
                    <th scope="row" className="px-4 py-4 font-semibold text-slate-800 sm:px-5"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] border border-orange-300/20 bg-orange-400/10 text-orange-300"><CalendarClock size={18}/></span>Unpaid expenses</span></th>
                    <td className="px-4 py-4 text-right text-lg font-extrabold tabular-nums text-orange-200 sm:px-5">{value(expenseSummary?.unpaidTotal)}</td>
                    <td className="px-4 py-4 text-xs text-[#515154] sm:px-5">Unpaid expense records in this scope</td>
                    <td className="px-4 py-4 text-right sm:px-5"><span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-2.5 py-1 text-[10px] font-semibold text-orange-200">{expenseSummary?.unpaidCount?.toLocaleString("en-IN") ?? "—"} open</span></td>
                  </tr>
                  <tr className="group transition-colors hover:bg-[#f5f5f7]">
                    <th scope="row" className="px-4 py-4 font-semibold text-slate-800 sm:px-5"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] border border-rose-300/20 bg-rose-400/10 text-rose-300"><TrendingUp size={18}/></span>Expense payments</span></th>
                    <td className="px-4 py-4 text-right text-lg font-extrabold tabular-nums text-rose-700 sm:px-5">{value(summary?.businessExpenses)}</td>
                    <td className="px-4 py-4 text-xs text-[#515154] sm:px-5">Actual expense cash outflow paid this month</td>
                    <td className="px-4 py-4 text-right sm:px-5"><span className="rounded-full border border-rose-300/20 bg-rose-300/10 px-2.5 py-1 text-[10px] font-semibold text-rose-700">Paid out</span></td>
                  </tr>
                  <tr className="group transition-colors hover:bg-amber-300/[0.06]">
                    <th scope="row" className="px-4 py-4 font-semibold text-slate-800 sm:px-5"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] border border-sky-300/20 bg-[#f5f5f7] text-[#0066cc]"><AlertCircle size={18}/></span>Data source</span></th>
                    <td className="px-4 py-4 text-right text-lg font-extrabold text-slate-900 sm:px-5">{summary ? "Shared" : "—"}</td>
                    <td className="px-4 py-4 text-xs text-[#515154] sm:px-5">Shared database metrics; browser ledgers remain separate</td>
                    <td className="px-4 py-4 text-right sm:px-5"><span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold text-amber-700">{summary ? "Connected" : "Waiting"}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[10px] leading-5 text-[#6e6e73]">Tip: on smaller screens, swipe horizontally to see all table columns. The warm amber glow highlights the summary without using separate metric cards.</p>
          </section>

        <p className="max-w-4xl px-1 text-xs leading-5 text-[#6e6e73]">
          Expense records and unpaid balances are authorized through the database summary function. Expense payments count as cash outflow only after payment is recorded; fixed monthly reminders alone are not booked expenses. Advance allocations are not new receipts.
        </p>
      </section>
      </main>
    </WorkspaceLayout>
  );
}

type SummaryCardAccent = "blue" | "red" | "purple" | "green" | "orange" | "yellow";

const summaryCardThemes: Record<SummaryCardAccent, {
  icon: string;
  value: string;
  bar: string;
  border: string;
  glow: string;
}> = {
  blue: { icon: "bg-[#f5f5f7] text-[#0066cc]", value: "text-[#1d1d1f]", bar: "bg-[#0066cc]", border: "hover:border-[#c7c7cc]", glow: "bg-[#f5f5f7]" },
  red: { icon: "bg-[#f5f5f7] text-[#0066cc]", value: "text-[#1d1d1f]", bar: "bg-[#0066cc]", border: "hover:border-[#c7c7cc]", glow: "bg-[#f5f5f7]" },
  purple: { icon: "bg-[#f5f5f7] text-[#0066cc]", value: "text-[#1d1d1f]", bar: "bg-[#0066cc]", border: "hover:border-[#c7c7cc]", glow: "bg-[#f5f5f7]" },
  green: { icon: "bg-[#f5f5f7] text-[#0066cc]", value: "text-[#1d1d1f]", bar: "bg-[#0066cc]", border: "hover:border-[#c7c7cc]", glow: "bg-[#f5f5f7]" },
  orange: { icon: "bg-[#f5f5f7] text-[#0066cc]", value: "text-[#1d1d1f]", bar: "bg-[#0066cc]", border: "hover:border-[#c7c7cc]", glow: "bg-[#f5f5f7]" },
  yellow: { icon: "bg-[#f5f5f7] text-[#0066cc]", value: "text-[#1d1d1f]", bar: "bg-[#0066cc]", border: "hover:border-[#c7c7cc]", glow: "bg-[#f5f5f7]" },
};

function SummaryCard({
  label,
  value,
  description,
  icon,
  accent = "blue",
}: {
  label: string;
  value: string;
  description: React.ReactNode;
  icon: React.ReactNode;
  accent?: SummaryCardAccent;
}) {
  const theme = summaryCardThemes[accent];

  return (
    <article className={`group relative flex min-h-[178px] min-w-0 flex-col overflow-hidden rounded-[18px] border border-[#e0e0e0] bg-white p-4 shadow-none transition-colors duration-200 hover:border-[#c7c7cc] sm:min-h-[192px] sm:p-5`}>



      <div className="relative z-10 flex items-start justify-between gap-3">
        <p className="min-w-0 pt-1 text-[13px] font-medium leading-5 text-[#515154] sm:text-sm">{label}</p>
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-[15px] ${theme.icon} ring-1 ring-black/[0.025] transition-colors duration-200`} aria-hidden="true">
          {icon}
        </span>
      </div>

      <p title={value} className={`relative z-10 mt-4 break-words text-[clamp(1.15rem,1.65vw,1.8rem)] font-bold leading-tight tracking-[-0.04em] [font-variant-numeric:tabular-nums] ${theme.value}`}>
        {value}
      </p>

      <div aria-hidden="true" className="relative z-10 mt-3 h-px w-full bg-slate-100" />
      <p className="relative z-10 mt-2 line-clamp-2 text-[12px] leading-5 text-[#6e6e73] sm:text-[13px]">{description}</p>

      <div aria-hidden="true" className="relative z-10 mt-auto flex items-center gap-1.5 pt-3">
        <span className={`h-1.5 w-5 rounded-full ${theme.bar}`} />
        <span className={`size-1.5 rounded-full ${theme.bar} opacity-40`} />
        <span className={`size-1.5 rounded-full ${theme.bar} opacity-20`} />
      </div>
    </article>
  );
}
