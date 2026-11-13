"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, RefreshCw, TrendingUp, Wallet } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  buildDashboardFinancialSummary,
  buildProfitAndLoss,
  formatDashboardCurrency,
  type DashboardFinancialSummary,
} from "@/lib/supabase/dashboard-summary";
import {
  isAuthorizedTestProjectConfigured,
  loadWorkspaceBranches,
  loadWorkspaceInstitutes,
  type WorkspaceBranch,
  type WorkspaceInstitute,
} from "@/lib/supabase/workspace-scope";

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100";
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

type ProfitResult = {
  scope: string;
  summary: DashboardFinancialSummary;
  studentCount: number;
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function ProfitLossReportPage() {
  const workspaceScope = useWorkspaceScope();
  const projectAllowed = isAuthorizedTestProjectConfigured();
  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [branches, setBranches] = useState<WorkspaceBranch[]>([]);
  const [branchesInstituteId, setBranchesInstituteId] = useState("");
  const [instituteId, setInstituteId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [month, setMonth] = useState("");
  const [result, setResult] = useState<ProfitResult | null>(null);
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
    if (!projectAllowed) return;
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
    if (branchId) {
      activityQuery = activityQuery.eq("branch_id", branchId);
      balanceQuery = balanceQuery.eq("branch_id", branchId);
      studentQuery = studentQuery.eq("branch_id", branchId);
    }
    void Promise.all([activityQuery, balanceQuery, studentQuery]).then(([activity, balances, students]) => {
      if (!active) return;
      if (activity.error || balances.error || students.error) {
        setErrorResult({ scope, message: "Profit and loss data is unavailable. Confirm the summary migrations are applied and that your role can view these records." });
        return;
      }
      setResult({
        scope,
        summary: buildDashboardFinancialSummary(activity.data ?? [], balances.data ?? []),
        studentCount: students.count ?? 0,
      });
      setErrorResult(null);
    }).catch(() => {
      if (active) setErrorResult({ scope, message: "Profit and loss data could not be loaded." });
    });
    return () => { active = false; };
  }, [branchId, instituteId, month, projectAllowed, reloadNumber, scope]);

  const visibleBranches = branchesInstituteId === instituteId ? branches : [];
  const selectedInstitute = institutes.find((item) => item.id === instituteId);
  const values = currentResult?.summary ?? emptySummary;
  const pnl = useMemo(() => buildProfitAndLoss(values), [values]);
  const money = { collectedRevenue: pnl.collectedRevenue, totalExpenses: pnl.totalExpenses };
  const netProfit = pnl.netProfit;
  const potentialProfit = pnl.potentialProfit;



  return (
    <WorkspaceLayout>
      <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <header className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#86198f] px-4 py-3 text-white shadow-lg shadow-purple-900/15 sm:px-5 sm:py-3.5">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full border-[16px] border-fuchsia-200/10 sm:size-44" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 left-1/3 size-32 rounded-full bg-violet-300/10 blur-2xl" />
          <div className="relative z-10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.13em] text-fuchsia-100"><span className="size-1.5 rounded-full bg-emerald-300" /> BIZBOOK · ACCOUNTS</p>
              <h1 className="mt-1 text-lg font-extrabold leading-tight tracking-tight sm:text-xl lg:text-2xl"><span className="text-white">Profit &amp;</span>{" "}<span className="bg-gradient-to-r from-amber-200 via-pink-200 to-cyan-200 bg-clip-text text-transparent">Loss Account</span></h1>
              <p className="mt-0.5 text-[11px] leading-4 text-violet-100 sm:text-xs">Monthly accounting statement of income, expenses and estimated outstanding collections.</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="max-w-[180px] truncate rounded-md border border-white/15 bg-white/10 px-2 py-1 text-white">{selectedInstitute?.name ?? "Your institute"}</span>
                {currentResult && <span className="rounded-md border border-emerald-200/20 bg-emerald-300/10 px-2 py-1 font-semibold text-emerald-100">{currentResult.studentCount} active students</span>}
              </div>
            </div>
            <div className="relative flex w-full flex-col gap-2 sm:flex-row sm:items-end md:w-auto md:shrink-0 md:justify-end">
              <label className="block w-full min-w-0 text-[10px] font-semibold text-violet-100 sm:w-[230px]">
                <span className="block">Reporting month</span>
                <input className="mt-1 block h-10 w-full min-w-0 rounded-xl border border-white/20 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-200" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
              </label>
              <button type="button" onClick={() => setReloadNumber((value) => value + 1)} disabled={loading || !instituteId} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-white/20 bg-white/10 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-60 sm:self-end"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {loading ? "Refreshing…" : "Refresh"}</button>
            </div>
          </div>
          <div className="relative mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-2 text-[10px] text-violet-100">
            <span>Selected period: <strong className="text-amber-200">{month || "Choose month"}</strong></span>
            <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5">Debit &amp; credit statement</span>
          </div>
        </header>

        {!projectAllowed && <div role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Shared data is disabled unless this workspace targets the authorized test project.</div>}
        {currentError && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{currentError}</div>}
        {!!currentResult?.summary.invalidRows && <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{currentResult.summary.invalidRows} malformed or direction-inconsistent financial summary row(s) were excluded. Totals may be incomplete; ask an institute administrator to review the ledger.</div>}
        {projectAllowed && <section className="mt-5 grid gap-3 sm:grid-cols-3">
          {institutes.length > 1 && <label className="text-xs font-semibold text-slate-600">Institute<select className={`${inputClass} mt-1`} value={instituteId} onChange={(event) => { setInstituteId(event.target.value); setBranchId(""); void workspaceScope.selectInstitute(event.target.value); }}><option value="">Choose institute</option>{institutes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {selectedInstitute?.accessScope === "branches" && visibleBranches.length > 1 && <label className="text-xs font-semibold text-slate-600">Assigned workspace<select className={`${inputClass} mt-1`} value={branchId} onChange={(event) => { setBranchId(event.target.value); workspaceScope.selectBranch(event.target.value); }} disabled={!instituteId}><option value="" disabled>Choose your assigned workspace</option>{visibleBranches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        </section>}
        {scopeLoading && <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Checking institute access…</div>}
        {projectAllowed && !scopeLoading && !institutes.length && <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No active institute membership is available for this account.</div>}

        {projectAllowed && instituteId && <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{selectedInstitute?.name ?? "Institute"} · {month || "Select a month"}</span><span>{currentResult ? `${currentResult.studentCount} active students` : loading ? "Loading verified data…" : ""}</span></div>

          <section className="mt-4 overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
            <div className="bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#86198f] px-4 py-3 text-white sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-200">Monthly accounts</p><h2 className="mt-0.5 text-base font-extrabold sm:text-lg">Profit &amp; loss statement</h2><p className="mt-0.5 text-[11px] text-violet-100">Income is shown on the credit side; expenses and refunds are shown on the debit side.</p></div>
                <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold">{month || "No month selected"}</span>
              </div>
            </div>
            <div className="grid gap-0 md:grid-cols-2">
              <div className="min-w-0 border-b border-slate-200 md:border-b-0 md:border-r">
                <div className="flex items-center justify-between bg-rose-50 px-4 py-3"><h3 className="text-sm font-extrabold text-rose-900">Debit · Expenses &amp; reductions</h3><span className="text-[10px] font-bold uppercase tracking-wide text-rose-700">Dr.</span></div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left font-semibold">Account head</th><th className="px-4 py-2 text-right font-semibold">Amount</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr><td className="px-4 py-3"><p className="font-semibold text-slate-800">Payroll paid</p><p className="text-[10px] text-slate-500">Salary paid during the month</p></td><td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-rose-700">{currentResult ? formatDashboardCurrency(values.payrollOutflow) : "—"}</td></tr>
                    <tr><td className="px-4 py-3"><p className="font-semibold text-slate-800">Business expenses paid</p><p className="text-[10px] text-slate-500">Recorded expenses actually paid</p></td><td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-rose-700">{currentResult ? formatDashboardCurrency(values.businessExpenses) : "—"}</td></tr>
                    <tr><td className="px-4 py-3"><p className="font-semibold text-slate-800">Completed refunds</p><p className="text-[10px] text-slate-500">Refunds reduce net income</p></td><td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-rose-700">{currentResult ? formatDashboardCurrency(values.completedRefunds) : "—"}</td></tr>
                  </tbody>
                  <tfoot className="bg-rose-50/70"><tr><th className="px-4 py-3 text-left text-xs font-extrabold text-rose-900">Total debit</th><th className="px-4 py-3 text-right font-extrabold text-rose-800">{currentResult ? formatDashboardCurrency(money.totalExpenses + values.completedRefunds) : "—"}</th></tr></tfoot>
                </table>
              </div>
              <div className="min-w-0">
                <div className="flex items-center justify-between bg-emerald-50 px-4 py-3"><h3 className="text-sm font-extrabold text-emerald-900">Credit · Income</h3><span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Cr.</span></div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left font-semibold">Account head</th><th className="px-4 py-2 text-right font-semibold">Amount</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr><td className="px-4 py-3"><p className="font-semibold text-slate-800">Student fee receipts</p><p className="text-[10px] text-slate-500">Fees received in the selected month</p></td><td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-700">{currentResult ? formatDashboardCurrency(values.feeReceipts) : "—"}</td></tr>
                    <tr><td className="px-4 py-3"><p className="font-semibold text-slate-800">Advance receipts</p><p className="text-[10px] text-slate-500">Cash received in advance; not counted twice</p></td><td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-700">{currentResult ? formatDashboardCurrency(values.advanceReceipts) : "—"}</td></tr>
                  </tbody>
                  <tfoot className="bg-emerald-50/70"><tr><th className="px-4 py-3 text-left text-xs font-extrabold text-emerald-900">Total credit</th><th className="px-4 py-3 text-right font-extrabold text-emerald-800">{currentResult ? formatDashboardCurrency(values.feeReceipts + values.advanceReceipts) : "—"}</th></tr></tfoot>
                </table>
              </div>
            </div>
            <div className={`flex flex-col gap-2 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${netProfit >= 0 ? "border-emerald-100 bg-emerald-50" : "border-rose-100 bg-rose-50"}`}>
              <div><p className={`text-[10px] font-bold uppercase tracking-[0.13em] ${netProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{netProfit >= 0 ? "Surplus · Net profit" : "Deficit · Net loss"}</p><p className="mt-0.5 text-xs text-slate-600">Credit income less debit expenses and completed refunds.</p></div>
              <p className={`text-2xl font-extrabold tracking-tight ${netProfit >= 0 ? "text-emerald-800" : "text-rose-800"}`}>{currentResult ? formatDashboardCurrency(netProfit) : "—"}</p>
            </div>
          </section>

          <section className="mt-4 grid gap-3 lg:grid-cols-2">
            <article className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 p-4 shadow-sm sm:p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">Potential position · estimate only</p>
              <h2 className="mt-1 text-base font-extrabold text-slate-900">If outstanding balances are collected</h2>
              <p className={`mt-2 text-2xl font-extrabold ${potentialProfit >= 0 ? "text-violet-800" : "text-rose-700"}`}>{currentResult ? formatDashboardCurrency(potentialProfit) : "—"}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">Estimated position = realized net profit + currently outstanding student installments ({currentResult ? formatDashboardCurrency(values.outstandingBalance) : "—"}). This is not realized profit or cash in hand; collectability and future costs may change the result.</p>
            </article>
            <article className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-4 shadow-sm sm:p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-700">Financial interpretation</p>
              <h2 className="mt-1 text-base font-extrabold text-slate-900">What these figures mean</h2>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
                <li className="flex gap-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-emerald-500" /><span><strong className="text-emerald-800">Income:</strong> fee and advance receipts recorded for the selected month.</span></li>
                <li className="flex gap-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-rose-500" /><span><strong className="text-rose-800">Expenses:</strong> payroll and business expenses paid, plus completed refunds as an income reduction.</span></li>
                <li className="flex gap-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-violet-500" /><span><strong className="text-violet-800">Outstanding:</strong> unpaid installments are potential collections, not current-period cash receipts.</span></li>
                <li className="flex gap-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" /><span><strong className="text-amber-800">Accounting note:</strong> this is a cash-basis management view. For formal accrual accounts, unearned advances may need to be shown as liabilities until the fees are earned.</span></li>
              </ul>
            </article>
          </section>

          <section className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4"><p className="text-sm font-semibold text-violet-900">Outstanding installment balance</p><p className="mt-2 text-2xl font-bold text-violet-950">{currentResult ? formatDashboardCurrency(values.outstandingBalance) : "—"}</p><p className="mt-1 text-xs text-violet-800">Shown separately from realized profit until collected.</p></div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">Overdue installments</p><p className="mt-2 text-2xl font-bold text-amber-950">{currentResult ? values.overdueInstallmentCount : "—"}</p><p className="mt-1 text-xs text-amber-800">Collection follow-up count based on the institute business date.</p></div>
          </section>

          {loading && <p role="status" className="mt-4 text-xs text-slate-500">Loading profit and loss…</p>}
        </>}
      </main>
    </WorkspaceLayout>
  );
}
