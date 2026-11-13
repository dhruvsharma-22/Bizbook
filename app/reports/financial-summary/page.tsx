"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Banknote, RefreshCw, Wallet } from "lucide-react";
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
import {
  isAuthorizedTestProjectConfigured,
  loadWorkspaceBranches,
  loadWorkspaceInstitutes,
  type WorkspaceBranch,
  type WorkspaceInstitute,
} from "@/lib/supabase/workspace-scope";

const emptySummary: DashboardFinancialSummary = {
  feeReceipts: 0,
  advanceReceipts: 0,
  completedRefunds: 0,
  payrollOutflow: 0,
  businessExpenses: 0,
  outstandingBalance: 0,
  overdueInstallmentCount: 0,
  invalidRows: 0,
};

type SummaryResult = { summary: DashboardFinancialSummary; expenseSummary: ExpenseObligationSummary; studentCount: number; scope: string };

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function FinancialSummaryPage() {
  const workspaceScope = useWorkspaceScope();
  const projectAllowed = isAuthorizedTestProjectConfigured();
  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [branches, setBranches] = useState<WorkspaceBranch[]>([]);
  const [branchesInstituteId, setBranchesInstituteId] = useState("");
  const [instituteId, setInstituteId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [month, setMonth] = useState("");
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [scopeLoading, setScopeLoading] = useState(projectAllowed);
  const [errorResult, setErrorResult] = useState<{ scope: string; message: string } | null>(null);
  const [reloadNumber, setReloadNumber] = useState(0);
  const scope = `${instituteId}|${branchId}|${month}`;
  const scopePending = workspaceScope.loading || (!!workspaceScope.selection
    && institutes.some((item) => item.id === workspaceScope.selection?.instituteId)
    && (instituteId !== workspaceScope.selection.instituteId || branchId !== workspaceScope.selection.branchId));
  const currentResult = !scopePending && result?.scope === scope ? result : null;
  const currentError = errorResult?.scope === scope || errorResult?.scope === instituteId ? errorResult.message : "";
  const loading = projectAllowed && !!instituteId && !!month && (scopePending || (!currentResult && !currentError));

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const next = workspaceScope.selection;
      if (!next || !institutes.some((item) => item.id === next.instituteId)) return;
      setInstituteId(next.instituteId);
      setBranchId(next.branchId);
      setErrorResult(null);
    });
    return () => { active = false; };
  }, [institutes, workspaceScope.selection]);

  useEffect(() => {
    let active = true;
    if (!projectAllowed) {
      return;
    }
    void loadWorkspaceInstitutes(createSupabaseBrowserClient())
      .then((rows) => {
        if (!active) return;
        setInstitutes(rows);
        setInstituteId((current) => rows.some((item) => item.id === current) ? current : rows[0]?.id ?? "");
        setMonth((current) => current || (rows[0] ? currentMonth() : ""));
      })
      .catch(() => { if (active) setErrorResult({ scope: "", message: "Institute access could not be verified. Sign in again or refresh." }); })
      .finally(() => { if (active) setScopeLoading(false); });
    return () => { active = false; };
  }, [projectAllowed]);

  useEffect(() => {
    let active = true;
    if (!projectAllowed || !instituteId) return;
    void loadWorkspaceBranches(createSupabaseBrowserClient(), instituteId)
      .then((rows) => {
        if (!active) return;
        setBranches(rows);
        setBranchesInstituteId(instituteId);
      })
      .catch(() => { if (active) setErrorResult({ scope: instituteId, message: "Accessible branches could not be loaded." }); });
    return () => { active = false; };
  }, [instituteId, projectAllowed]);

  useEffect(() => {
    let active = true;
    if (!projectAllowed || !instituteId || !month) return;
    const supabase = createSupabaseBrowserClient();
    let activityQuery = supabase
      .from("financial_activity_summary")
      .select("category, direction, amount_total")
      .eq("institute_id", instituteId)
      .eq("activity_month", `${month}-01`);
    let balanceQuery = supabase
      .from("installment_balance_summary")
      .select("balance_status, installment_count, outstanding_amount_total")
      .eq("institute_id", instituteId);
    let studentQuery = supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("institute_id", instituteId)
      .is("archived_at", null);
    const expenseSummaryQuery = supabase.rpc("expense_dashboard_summary", {
      p_institute_id: instituteId,
      p_branch_id: branchId || null,
      p_month_start: `${month}-01`,
    });
    if (branchId) {
      activityQuery = activityQuery.eq("branch_id", branchId);
      balanceQuery = balanceQuery.eq("branch_id", branchId);
      studentQuery = studentQuery.eq("branch_id", branchId);
    }
    void Promise.all([activityQuery, balanceQuery, studentQuery, expenseSummaryQuery]).then(([activity, balances, students, expenses]) => {
      if (!active) return;
      if (activity.error || balances.error || students.error || expenses.error) {
        setErrorResult({ scope, message: "Financial summaries are unavailable. Confirm the test database summary migrations are applied and that your role can view these records." });
        return;
      }
      setResult({
        scope,
        summary: buildDashboardFinancialSummary(activity.data ?? [], balances.data ?? []),
        expenseSummary: buildExpenseObligationSummary(expenses.data ?? []),
        studentCount: students.count ?? 0,
      });
      setErrorResult(null);
    }).catch(() => {
      if (active) setErrorResult({ scope, message: "Financial summaries could not be loaded." });
    });
    return () => { active = false; };
  }, [branchId, instituteId, month, projectAllowed, reloadNumber, scope]);

  const visibleBranches = branchesInstituteId === instituteId ? branches : [];
  const selectedInstitute = institutes.find((item) => item.id === instituteId);
  const values = currentResult?.summary ?? emptySummary;
  const expenseSummary = currentResult?.expenseSummary;

  const totalReceipts = values.feeReceipts + values.advanceReceipts;
  const netCollections = totalReceipts - values.completedRefunds;
  const paidOutflow = values.payrollOutflow + values.businessExpenses;
  const netCashMovement = netCollections - paidOutflow;
  const totalRecordedExpenses = expenseSummary?.recordedMonthTotal ?? 0;
  const unpaidExpenses = expenseSummary?.unpaidTotal ?? 0;
  const totalOpenObligations = values.outstandingBalance + unpaidExpenses;
  const receiptBase = Math.max(totalReceipts, 1);
  const feeShare = Math.min(100, (values.feeReceipts / receiptBase) * 100);
  const advanceShare = Math.min(100, (values.advanceReceipts / receiptBase) * 100);
  const outflowBase = Math.max(paidOutflow, 1);
  const payrollShare = Math.min(100, (values.payrollOutflow / outflowBase) * 100);
  const expenseShare = Math.min(100, (values.businessExpenses / outflowBase) * 100);
  const reportMonth = month
    ? new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "Select a month";
  const money = (amount: number) => formatDashboardCurrency(Number.isFinite(amount) ? amount : 0);

  const summaryRows = [
    { label: "Student fee receipts", detail: "Collected against student fees", amount: values.feeReceipts, kind: "income" },
    { label: "Advance receipts", detail: "Advance payments received", amount: values.advanceReceipts, kind: "income" },
    { label: "Total receipts", detail: "Student fees + advances", amount: totalReceipts, kind: "subtotal" },
    { label: "Completed refunds", detail: "Refunds actually completed", amount: values.completedRefunds, kind: "deduction" },
    { label: "Net collections", detail: "Total receipts less completed refunds", amount: netCollections, kind: "net" },
    { label: "Payroll paid", detail: "Salary payments recorded", amount: values.payrollOutflow, kind: "expense" },
    { label: "Business expenses paid", detail: "Paid expense cash outflow", amount: values.businessExpenses, kind: "expense" },
    { label: "Total paid outflow", detail: "Payroll + paid business expenses", amount: paidOutflow, kind: "subtotalExpense" },
    { label: "Net cash movement", detail: "Net collections less paid outflow", amount: netCashMovement, kind: "final" },
    { label: "Open obligations", detail: "Outstanding installments + unpaid expenses", amount: totalOpenObligations, kind: "obligation" },
  ];

  const financialInsights = [
    {
      title: netCashMovement > 0 ? "Positive monthly cash movement" : netCashMovement < 0 ? "Cash outflow is above collections" : "Collections and outflow are balanced",
      text: netCashMovement > 0
        ? `Net collections are higher than recorded paid outflow by ${money(netCashMovement)} for ${reportMonth}.`
        : netCashMovement < 0
          ? `Recorded paid outflow exceeds net collections by ${money(Math.abs(netCashMovement))}. Review upcoming payments and expected collections.`
          : `Net collections and recorded paid outflow are equal for ${reportMonth}.`,
      tone: netCashMovement > 0 ? "emerald" : netCashMovement < 0 ? "rose" : "sky",
    },
    {
      title: values.outstandingBalance > 0 ? "Collection follow-up is needed" : "No installment balance is currently showing",
      text: values.outstandingBalance > 0
        ? `${money(values.outstandingBalance)} remains outstanding across student installments${values.overdueInstallmentCount > 0 ? `, with ${values.overdueInstallmentCount} overdue installment(s)` : ""}. Follow up on due payments.`
        : "The current installment balance summary shows no outstanding student installment amount.",
      tone: values.outstandingBalance > 0 ? "violet" : "emerald",
    },
    {
      title: unpaidExpenses > 0 ? "Plan for unpaid expenses" : "No unpaid expense balance is showing",
      text: unpaidExpenses > 0
        ? `${money(unpaidExpenses)} across ${expenseSummary?.unpaidCount ?? 0} open expense record(s) may need payment planning. These are not counted as cash already paid.`
        : "The current expense summary shows no unpaid recorded expenses for this scope.",
      tone: unpaidExpenses > 0 ? "amber" : "emerald",
    },
    {
      title: "Keep an eye on the spending mix",
      text: `Recorded paid outflow is ${money(paidOutflow)}: payroll ${money(values.payrollOutflow)} and business expenses ${money(values.businessExpenses)}. Compare these amounts with your operating budget.`,
      tone: "blue",
    },
  ];

  return (
    <WorkspaceLayout>
      <main className="min-h-screen bg-[#f4f7fb] p-4 text-slate-800 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-[1440px] space-y-6">
          <header className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#86198f] px-3.5 py-3 text-white shadow-lg shadow-purple-900/15 sm:px-4 sm:py-3.5">
            <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full border-[16px] border-fuchsia-200/10 sm:size-44" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 left-1/3 size-32 rounded-full bg-violet-300/10 blur-2xl" />
            <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[9px] font-bold tracking-[0.13em] text-fuchsia-100">
                  <span className="size-1.5 rounded-full bg-emerald-300" />
                  BIZBOOK · ACCOUNTS
                </div>
                <h1 className="mt-1 text-lg font-extrabold leading-tight tracking-tight sm:text-xl lg:text-2xl">
                  <span className="text-white">Financial</span>{" "}
                  <span className="bg-gradient-to-r from-amber-200 via-pink-200 to-cyan-200 bg-clip-text text-transparent">Summary</span>
                </h1>
                <p className="mt-0.5 text-[11px] leading-4 text-violet-100 sm:text-xs">
                  Monthly receipts, refunds, payments and outstanding balances.
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="max-w-[180px] truncate rounded-md border border-white/15 bg-white/10 px-2 py-1 text-white">{selectedInstitute?.name ?? "Your institute"}</span>
                  {currentResult && <span className="rounded-md border border-emerald-200/20 bg-emerald-300/10 px-2 py-1 font-semibold text-emerald-100">{currentResult.studentCount} active students</span>}
                </div>
              </div>

              <div className="relative flex flex-col gap-2 sm:flex-row sm:items-end md:shrink-0 md:justify-end">
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-[minmax(150px,190px)_auto] lg:items-end">
                  {institutes.length > 1 && <label className="min-w-0 text-[10px] font-semibold text-violet-100">Institute<select className="mt-1 w-full rounded-lg border border-white/20 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-200" value={instituteId} onChange={(event) => { setInstituteId(event.target.value); setBranchId(""); void workspaceScope.selectInstitute(event.target.value); }}><option value="">Choose institute</option>{institutes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
                  {selectedInstitute?.accessScope === "branches" && visibleBranches.length > 1 && <label className="min-w-0 text-[10px] font-semibold text-violet-100">Workspace<select className="mt-1 w-full rounded-lg border border-white/20 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-200" value={branchId} onChange={(event) => { setBranchId(event.target.value); workspaceScope.selectBranch(event.target.value); }} disabled={!instituteId}><option value="" disabled>Choose workspace</option>{visibleBranches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
                  <label className="min-w-0 text-[10px] font-semibold text-violet-100">Reporting month<input className="mt-1 w-full rounded-lg border border-white/20 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-200" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
                </div>
                <button type="button" suppressHydrationWarning onClick={() => setReloadNumber((value) => value + 1)} disabled={loading || !instituteId} className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[11px] font-semibold text-white shadow-sm transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto md:self-end">
                  <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
              </div>
            </div>
            <div className="relative mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-2 text-[10px] text-violet-100">
              <span>Selected period: <strong className="text-amber-200">{reportMonth}</strong></span>
              <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5">Monthly accounting basis</span>
            </div>
          </header>

          {!projectAllowed && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Shared data is disabled unless this workspace targets the authorized test project.</div>}
          {currentError && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{currentError}</div>}
          {!!((currentResult?.summary.invalidRows ?? 0) + (currentResult?.expenseSummary.invalidRows ?? 0)) && <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{(currentResult?.summary.invalidRows ?? 0) + (currentResult?.expenseSummary.invalidRows ?? 0)} malformed financial summary row(s) were excluded. Totals may be incomplete; ask an institute administrator to review the ledger.</div>}

          {projectAllowed && instituteId && (
              <section className="relative isolate overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-md shadow-violet-900/5">
                <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full border-[18px] border-fuchsia-100/70" />
                <div className="relative bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#86198f] px-4 py-4 text-white sm:px-5 sm:py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-fuchsia-200">BizBook · Financial health</p>
                      <h2 className="mt-1 text-base font-extrabold tracking-tight text-white sm:text-lg">Your financial position</h2>
                      <p className="mt-1 text-xs text-violet-100">Four practical observations for the selected reporting month.</p>
                    </div>
                    <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white">{reportMonth}</span>
                  </div>
                </div>
                {!currentResult ? (
                  <div className="px-5 py-6 text-sm text-slate-500 sm:px-6">Financial insights will appear here once the selected month’s figures have loaded.</div>
                ) : (
                  <ul className="relative grid gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-4">
                    {financialInsights.map((insight, index) => {
                      const toneClasses: Record<string, string> = {
                        emerald: "border-emerald-100 bg-emerald-50/70 text-emerald-700",
                        rose: "border-rose-100 bg-rose-50/70 text-rose-700",
                        sky: "border-sky-100 bg-sky-50/70 text-sky-700",
                        violet: "border-violet-100 bg-violet-50/70 text-violet-700",
                        amber: "border-amber-100 bg-amber-50/70 text-amber-700",
                        blue: "border-blue-100 bg-blue-50/70 text-blue-700",
                      };
                      return (
                        <li key={insight.title} className={`rounded-xl border p-3 transition-shadow hover:shadow-sm sm:p-4 ${toneClasses[insight.tone] ?? toneClasses.blue}`}>
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-white/90 text-xs font-extrabold shadow-sm">{String(index + 1).padStart(2, "0")}</span>
                            <div className="min-w-0">
                              <h3 className="text-sm font-bold">{insight.title}</h3>
                              <p className="mt-1.5 text-sm leading-6 text-slate-600">{insight.text}</p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="border-t border-slate-100 px-5 py-3 sm:px-6">
                  <p className="text-[11px] leading-5 text-slate-400">These are operational observations, not a credit rating or a formal accounting opinion. They use only the figures available in BizBook for the selected scope.</p>
                </div>
              </section>


          )}



          {scopeLoading && <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Checking institute access…</div>}
          {projectAllowed && !scopeLoading && !institutes.length && <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No active institute membership is available for this account.</div>}

          {projectAllowed && instituteId && (
            <>


              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:px-6">
                    <div>
                      <div className="flex items-center gap-2"><span className="rounded-lg bg-[#eaf2fb] p-2 text-[#234d74]"><Banknote size={18} /></span><h2 className="text-base font-bold text-slate-900">Income & expenditure statement</h2></div>
                      <p className="mt-2 text-xs text-slate-500">Cash-based summary from recorded receipts and payments.</p>
                    </div>
                  </div>
                  <div className="p-5 sm:p-6">
                    <div className="overflow-hidden rounded-xl border border-slate-100">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 bg-slate-50 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500"><span>Account / particulars</span><span className="text-right">Amount</span></div>
                      {summaryRows.map((row) => (
                        <div key={row.label} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-slate-100 px-4 py-3.5 ${["subtotal", "net", "subtotalExpense"].includes(row.kind) ? "bg-slate-50/80" : row.kind === "final" ? "border-t-2 border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50" : row.kind === "obligation" ? "bg-amber-50/60" : ""}`}>
                          <div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{row.label}</p><p className="mt-0.5 text-[11px] text-slate-400">{row.detail}</p></div>
                          <p className={`text-right tabular-nums ${row.kind === "final" ? "text-base font-extrabold" : row.kind === "net" || row.kind === "subtotal" || row.kind === "subtotalExpense" ? "text-sm font-extrabold" : "text-sm font-bold"} ${row.kind === "income" || row.kind === "subtotal" || row.kind === "net" ? "text-emerald-700" : row.kind === "deduction" ? "text-amber-700" : row.kind === "obligation" ? "text-violet-700" : row.kind === "final" && netCashMovement >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{currentResult ? `${row.kind === "deduction" || row.kind === "expense" || row.kind === "subtotalExpense" ? "−" : row.kind === "income" ? "+" : ""}${money(row.amount)}` : "—"}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] leading-5 text-slate-400">This is a management cash summary, not a statutory profit-and-loss statement or a bank reconciliation.</p>
                  </div>
                </article>
              </section>

              <section className="grid gap-4 md:grid-cols-2">
<article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                    <div className="flex items-center gap-2"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><ArrowUpRight size={18} /></span><h2 className="text-base font-bold text-slate-900">Receipt composition</h2></div>
                    <p className="mt-1 text-xs text-slate-500">Where this month’s incoming money came from.</p>
                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-medium text-slate-700">Student fee receipts</span><span className="text-sm font-bold text-slate-900">{currentResult ? money(values.feeReceipts) : "—"}</span></div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${feeShare}%` }} /></div>
                        <p className="mt-1.5 text-right text-[11px] text-slate-400">{currentResult ? `${feeShare.toFixed(1)}% of receipts` : "—"}</p>
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-medium text-slate-700">Advance receipts</span><span className="text-sm font-bold text-slate-900">{currentResult ? money(values.advanceReceipts) : "—"}</span></div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${advanceShare}%` }} /></div>
                        <p className="mt-1.5 text-right text-[11px] text-slate-400">{currentResult ? `${advanceShare.toFixed(1)}% of receipts` : "—"}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-slate-600">Total receipts</span><span className="text-lg font-extrabold text-slate-900">{currentResult ? money(totalReceipts) : "—"}</span></div><div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500"><span>Less completed refunds</span><span className="font-semibold text-amber-700">{currentResult ? `−${money(values.completedRefunds)}` : "—"}</span></div></div>
                    </div>
                  </article>

                  <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                    <div className="flex items-center gap-2"><span className="rounded-lg bg-rose-50 p-2 text-rose-700"><ArrowDownRight size={18} /></span><h2 className="text-base font-bold text-slate-900">Payment composition</h2></div>
                    <p className="mt-1 text-xs text-slate-500">Recorded cash outflow by payment type.</p>
                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-medium text-slate-700">Payroll paid</span><span className="text-sm font-bold text-slate-900">{currentResult ? money(values.payrollOutflow) : "—"}</span></div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-rose-500" style={{ width: `${payrollShare}%` }} /></div>
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-medium text-slate-700">Business expenses paid</span><span className="text-sm font-bold text-slate-900">{currentResult ? money(values.businessExpenses) : "—"}</span></div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-400" style={{ width: `${expenseShare}%` }} /></div>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-rose-50 px-4 py-3"><span className="text-sm font-semibold text-rose-900">Total paid outflow</span><span className="text-base font-extrabold text-rose-800">{currentResult ? money(paidOutflow) : "—"}</span></div>
                    </div>
                  </article>
              </section>

              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Expenses recorded</p><p className="mt-3 text-2xl font-bold text-slate-900">{currentResult ? money(totalRecordedExpenses) : "—"}</p><p className="mt-2 text-xs leading-5 text-slate-500">Includes paid and unpaid expense records dated in this month.</p></article>
                <article className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Unpaid expenses</p><p className="mt-3 text-2xl font-bold text-amber-700">{currentResult ? money(unpaidExpenses) : "—"}</p><p className="mt-2 text-xs leading-5 text-slate-500">{expenseSummary?.unpaidCount ?? 0} open expense records in this scope.</p></article>
                <article className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Installments outstanding</p><p className="mt-3 text-2xl font-bold text-violet-700">{currentResult ? money(values.outstandingBalance) : "—"}</p><p className="mt-2 text-xs leading-5 text-slate-500">Current outstanding student installment balance.</p></article>
                <article className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Overdue installments</p><p className="mt-3 text-2xl font-bold text-sky-700">{currentResult ? values.overdueInstallmentCount : "—"}</p><p className="mt-2 text-xs leading-5 text-slate-500">Count reflects the current installment balance view.</p></article>
              </section>

              <section className="grid gap-4 xl:grid-cols-2">
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex items-center gap-2"><span className="rounded-lg bg-amber-50 p-2 text-amber-700"><Wallet size={18} /></span><h2 className="text-base font-bold text-slate-900">Outstanding balances & liabilities</h2></div>
                  <p className="mt-1 text-xs text-slate-500">Items that still need collection or payment.</p>
                  <div className="mt-4 divide-y divide-slate-100">
                    <div className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-semibold text-slate-700">Student installments to collect</p><p className="mt-1 text-xs text-slate-400">Outstanding balance</p></div><p className="text-right text-sm font-bold text-violet-700">{currentResult ? money(values.outstandingBalance) : "—"}</p></div>
                    <div className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-semibold text-slate-700">Expenses to pay</p><p className="mt-1 text-xs text-slate-400">Unpaid recorded expenses</p></div><p className="text-right text-sm font-bold text-amber-700">{currentResult ? money(unpaidExpenses) : "—"}</p></div>
                    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-4"><div><p className="text-sm font-bold text-slate-900">Combined open obligations</p><p className="mt-1 text-xs text-slate-500">Collection balance + unpaid expenses</p></div><p className="text-right text-lg font-extrabold text-slate-900">{currentResult ? money(totalOpenObligations) : "—"}</p></div>
                  </div>
                </article>
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex items-center gap-2"><span className="rounded-lg bg-slate-100 p-2 text-slate-700"><Banknote size={18} /></span><h2 className="text-base font-bold text-slate-900">Accounting notes</h2></div>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                    <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500" /><span>Fee and advance receipts are displayed separately; the net collection figure deducts completed refunds.</span></li>
                    <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-rose-500" /><span>Cash outflow includes payroll and paid business expenses. Unpaid expense records are not treated as cash already paid.</span></li>
                    <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" /><span>Subscription revenue is not included because the current database does not contain a BizBook subscription revenue ledger.</span></li>
                    <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-sky-500" /><span>For formal accounts, add a chart of accounts, journal entries, opening/closing balances, and bank reconciliation before treating this as a statutory statement.</span></li>
                  </ul>
                </article>
              </section>
              {loading && <div role="status" className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800"><span className="inline-flex items-center gap-2"><RefreshCw size={15} className="animate-spin" /> Loading verified accounting figures…</span></div>}
              <p className="px-1 pb-2 text-center text-[11px] leading-5 text-slate-400">Amounts are calculated from the current authorized workspace data. Verify source records before using figures for tax, audit, or statutory reporting.</p>
            </>
          )}
        </div>
      </main>
    </WorkspaceLayout>
  );
}
