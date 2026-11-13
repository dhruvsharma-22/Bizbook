"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowDownLeft, CheckCircle2, ChevronLeft, ChevronRight, Filter, RefreshCw, Search, WalletCards, XCircle } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import StudentAvatar from "@/components/StudentAvatar";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PaymentStatus } from "@/lib/supabase/database.types";
import {
  isAuthorizedTestProjectConfigured,
  loadWorkspaceBranches,
  loadWorkspaceInstitutes,
  type WorkspaceBranch,
  type WorkspaceInstitute,
} from "@/lib/supabase/workspace-scope";
import { summarizePaymentRefunds, type PaymentHistoryRefund } from "@/lib/supabase/payment-history";

type PaymentRow = {
  id: string;
  institute_id: string;
  branch_id: string | null;
  student_id: string;
  receipt_kind: "Fee" | "Advance";
  amount: number | string;
  payment_date: string;
  method: string;
  mode: "Manual" | "Online";
  status: string;
  provider: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  provider_reference: string | null;
  created_at: string;
};

type StudentOption = { id: string; name: string; gender?: "Male" | "Female" | "Other" | null };
type HistoryRow = PaymentRow & {
  studentName: string;
  studentGender: "Male" | "Female" | "Other";
  branchName: string;
  refunds: PaymentHistoryRefund[];
  completedRefundAmount: number;
  pendingRefundAmount: number;
};
type PageResult = { key: string; rows: HistoryRow[]; total: number };
type QueryPage<T> = { data: T[] | null; error: { message: string } | null; count: number | null };

const PAGE_SIZE = 25;
const paymentStatuses = ["Pending", "Processing", "Paid", "Partially Refunded", "Refunded", "Failed", "Cancelled"] as const;
const fieldClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100";
const money = (value: number | string) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(Number.isFinite(Number(value)) ? Number(value) : 0);

function displayDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

async function readAllPages<T>(getPage: (from: number, to: number) => PromiseLike<QueryPage<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 100_000; offset += 1_000) {
    const { data, error, count } = await getPage(offset, offset + 999);
    if (error) throw new Error("The authorized student list could not be loaded.");
    rows.push(...(data ?? []));
    if (!data?.length || data.length < 1_000 || (count !== null && rows.length >= count)) return rows;
  }
  throw new Error("Student filters are too large to load. Choose a branch to narrow the list.");
}

export default function SharedPaymentHistory({ onUseBrowser }: { onUseBrowser?: () => void } = {}) {
  const workspaceScope = useWorkspaceScope();
  const projectAllowed = isAuthorizedTestProjectConfigured();
  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [branches, setBranches] = useState<WorkspaceBranch[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [instituteId, setInstituteId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const next = workspaceScope.selection;
      if (!next || !institutes.some((item) => item.id === next.instituteId)) return;
      setInstituteId(next.instituteId);
      setBranchId(next.branchId);
      setPage(0);
    });
    return () => { active = false; };
  }, [institutes, workspaceScope.selection]);
  const [scopeLoading, setScopeLoading] = useState(projectAllowed);
  const [scopeError, setScopeError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [pageResult, setPageResult] = useState<PageResult | null>(null);
  const [errorResult, setErrorResult] = useState<{ key: string; message: string } | null>(null);

  const institute = institutes.find((item) => item.id === instituteId);
  const canViewRole = institute?.role === "owner" || institute?.role === "administrator" || institute?.role === "accountant";
  const canView = canViewRole && (institute?.accessScope === "institute" || !!branchId);
  const scopePending = workspaceScope.loading || (!!workspaceScope.selection
    && institutes.some((item) => item.id === workspaceScope.selection?.instituteId)
    && (instituteId !== workspaceScope.selection.instituteId || branchId !== workspaceScope.selection.branchId));
  const queryKey = JSON.stringify([instituteId, branchId, studentId, status, fromDate, toDate, page, reload]);
  const currentResult = !scopePending && pageResult?.key === queryKey ? pageResult : null;
  const currentError = errorResult?.key === queryKey ? errorResult.message : "";
  const pageCount = Math.max(1, Math.ceil((currentResult?.total ?? 0) / PAGE_SIZE));
  const branchesForInstitute = useMemo(() => branches, [branches]);

  useEffect(() => {
    let active = true;
    if (!projectAllowed) return;
    void loadWorkspaceInstitutes(createSupabaseBrowserClient())
      .then((rows) => {
        if (!active) return;
        setInstitutes(rows);
        setInstituteId(rows[0]?.id ?? "");
      })
      .catch(() => { if (active) setScopeError("Institute access could not be verified. Sign in again or refresh."); })
      .finally(() => { if (active) setScopeLoading(false); });
    return () => { active = false; };
  }, [projectAllowed]);

  useEffect(() => {
    let active = true;
    if (!projectAllowed || !instituteId) return;
    const supabase = createSupabaseBrowserClient();
    void Promise.all([
      loadWorkspaceBranches(supabase, instituteId),
      readAllPages<StudentOption>((from, to) => supabase
        .from("students")
        .select("id, name, gender", { count: "exact" })
        .eq("institute_id", instituteId)
        .order("name")
        .range(from, to)),
    ])
      .then(([branchRows, studentRows]) => {
        if (!active) return;
        setBranches(branchRows);
        setStudents(studentRows);
        setLookupError("");
      })
      .catch(() => { if (active) setLookupError("Accessible branches and students could not be loaded."); });
    return () => { active = false; };
  }, [instituteId, projectAllowed]);

  useEffect(() => {
    let active = true;
    if (!projectAllowed || !instituteId || !canView || scopePending) return;
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        let query = supabase.from("payments")
          .select("id, institute_id, branch_id, student_id, receipt_kind, amount, payment_date, method, mode, status, provider, provider_order_id, provider_payment_id, provider_reference, created_at", { count: "exact" })
          .eq("institute_id", instituteId)
          .order("payment_date", { ascending: false })
          .order("created_at", { ascending: false });
        if (branchId) query = query.eq("branch_id", branchId);
        if (studentId) query = query.eq("student_id", studentId);
        if (status) query = query.eq("status", status as PaymentStatus);
        if (fromDate) query = query.gte("payment_date", fromDate);
        if (toDate) query = query.lte("payment_date", toDate);

        const { data, error, count } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw new Error("Payment history is not available for this account.");
        const payments = (data ?? []) as PaymentRow[];
        const paymentIds = payments.map((item) => item.id);
        let refundRows: PaymentHistoryRefund[] = [];
        if (paymentIds.length) {
          const result = await supabase.from("refunds")
            .select("id, payment_id, amount, status, mode, provider_refund_reference, created_at")
            .eq("institute_id", instituteId)
            .in("payment_id", paymentIds)
            .order("created_at", { ascending: false });
          if (result.error) throw new Error("Refund information could not be loaded.");
          refundRows = (result.data ?? []) as PaymentHistoryRefund[];
        }
        const studentIds = [...new Set(payments.map((item) => item.student_id))];
        const studentDetails = new Map<string, { name: string; gender: "Male" | "Female" | "Other" }>();
        if (studentIds.length) {
          const result = await supabase.from("students")
            .select("id, name, gender")
            .eq("institute_id", instituteId)
            .in("id", studentIds);
          if (result.error) throw new Error("Student details could not be loaded.");
          for (const student of result.data ?? []) {
            const gender = student.gender === "Male" || student.gender === "Female" ? student.gender : "Other";
            studentDetails.set(student.id, { name: student.name, gender });
          }
        }
        const refundSummary = summarizePaymentRefunds(refundRows);
        const branchNames = new Map(branches.map((item) => [item.id, item.name]));
        const rows = payments.map((payment) => {
          const refund = refundSummary.get(payment.id);
          return {
            ...payment,
            studentName: studentDetails.get(payment.student_id)?.name ?? "Archived or unavailable student",
            studentGender: studentDetails.get(payment.student_id)?.gender ?? "Other",
            branchName: payment.branch_id ? branchNames.get(payment.branch_id) ?? "Accessible branch" : "Institute-wide",
            refunds: refund?.refunds ?? [],
            completedRefundAmount: refund?.completedAmount ?? 0,
            pendingRefundAmount: refund?.pendingAmount ?? 0,
          };
        });
        if (active) {
          setPageResult({ key: queryKey, rows, total: count ?? rows.length });
          setErrorResult(null);
        }
      } catch {
        if (active) setErrorResult({ key: queryKey, message: "Payment history could not be loaded. Confirm test-project migrations and finance access." });
      }
    })();
    return () => { active = false; };
  }, [branchId, branches, canView, fromDate, instituteId, page, projectAllowed, queryKey, reload, scopePending, status, studentId, toDate]);

  function resetPage(change: () => void) {
    change();
    setPage(0);
  }

  const rows = currentResult?.rows ?? [];
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!normalizedSearch) return rows;
    return rows.filter((row) => [
      row.studentName,
      row.receipt_kind,
      row.method,
      row.status,
      row.provider_reference,
      row.provider_payment_id,
      row.id,
      row.branchName,
      row.mode,
      row.provider,
    ].some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch)));
  }, [normalizedSearch, rows]);
  const loading = projectAllowed && !!instituteId && canView && (scopePending || (!currentResult && !currentError));

  return (
    <WorkspaceLayout>
      <main className="min-h-screen bg-slate-50 px-0 pb-6 sm:px-4 sm:py-4 lg:px-6">
        <div className="mx-auto max-w-3xl">
          {/* Minimal standalone search bar — no large header card */}
          <div className="sticky top-0 z-20 bg-slate-50 px-3 py-3 sm:static sm:px-0 sm:pt-0">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm transition focus-within:border-violet-300 focus-within:ring-4 focus-within:ring-violet-100 sm:rounded-xl">
              <Search size={19} className="shrink-0 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search student, payment, or receipt ID..."
                aria-label="Search payment history"
                className="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0 sm:h-12"
              />
              {searchTerm && <button type="button" onClick={() => setSearchTerm("")} aria-label="Clear search" className="flex size-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-violet-50 hover:text-violet-700"><XCircle size={16} /></button>}
              <span className="mx-1 h-6 w-px shrink-0 bg-slate-200" aria-hidden="true" />
              <button type="button" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters} aria-label={showFilters ? "Hide filters" : "Show filters"} className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${showFilters ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:bg-violet-50 hover:text-violet-700"}`}>
                <Filter size={18} />
              </button>
              <button type="button" onClick={() => setReload((value) => value + 1)} disabled={loading} aria-label="Refresh payment history" className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50">
                <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          <div className="space-y-3 px-2.5 pt-3 sm:px-0 sm:pt-4">
            {!projectAllowed ? (
              <div role="alert" className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertCircle size={19} className="mt-0.5 shrink-0" /><p>Shared payment history is enabled only when the configured Supabase URL is the authorized HTTPS test project. Browser entry remains available separately.</p></div>
            ) : scopeLoading ? (
              <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500"><RefreshCw size={20} className="mx-auto mb-2 animate-spin text-violet-600" />Checking institute access…</div>
            ) : scopeError ? (
              <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{scopeError}</div>
            ) : !institutes.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><h2 className="font-bold text-slate-800">No institute access</h2><p className="mt-2 text-sm text-slate-500">Sign in with an authorized institute account.</p></div>
            ) : (
              <>
                {showFilters && (
                  <section className="rounded-2xl border border-violet-100/90 bg-white/95 p-4 shadow-[0_8px_28px_rgba(91,33,182,0.06)] sm:p-5">
                    <div className="mb-3 flex items-center justify-between gap-2"><div><h2 className="text-sm font-bold text-slate-900">Find transactions</h2><p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">Filter receipts by student, status, branch or date.</p></div><button type="button" onClick={() => setShowFilters(false)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50">Done</button></div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {institutes.length > 1 && <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">Institute<select className={`${fieldClass} min-w-0`} value={instituteId} onChange={(event) => { const next = event.target.value; setInstituteId(next); setBranchId(""); setStudentId(""); setPage(0); void workspaceScope.selectInstitute(next); }}>{institutes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
                      {institute?.accessScope === "branches" && branchesForInstitute.length > 1 && <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">Branch<select className={`${fieldClass} min-w-0`} value={branchId} onChange={(event) => { const next = event.target.value; resetPage(() => setBranchId(next)); workspaceScope.selectBranch(next); }}><option value="" disabled>Choose an assigned branch</option>{branchesForInstitute.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
                      <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">Student<select className={`${fieldClass} min-w-0`} value={studentId} onChange={(event) => resetPage(() => setStudentId(event.target.value))}><option value="">All students</option>{students.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                      <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">Payment status<select className={`${fieldClass} min-w-0`} value={status} onChange={(event) => resetPage(() => setStatus(event.target.value))}><option value="">All statuses</option>{paymentStatuses.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                      <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">From date<input className={`${fieldClass} min-w-0`} type="date" value={fromDate} onChange={(event) => resetPage(() => setFromDate(event.target.value))} /></label>
                      <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">To date<input className={`${fieldClass} min-w-0`} type="date" value={toDate} onChange={(event) => resetPage(() => setToDate(event.target.value))} /></label>
                    </div>
                  </section>
                )}

                {lookupError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{lookupError}</div>}
                {!canViewRole ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Payment history requires owner, administrator, or accountant access.</div> : institute?.accessScope === "branches" && !branchId ? <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Choose one assigned branch to view payment history.</div> : currentError ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle size={18} className="mt-0.5 shrink-0" />{currentError}</div> : loading ? <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm"><RefreshCw size={20} className="mx-auto mb-2 animate-spin text-violet-600" />Loading payment history…</div> : (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-3 py-3 sm:px-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="hidden size-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 sm:flex"><WalletCards size={19} /></div>
                        <div className="min-w-0"><h2 className="text-sm font-extrabold tracking-tight text-slate-900 sm:text-base">Recent transactions</h2><p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">{visibleRows.length.toLocaleString("en-IN")} of {currentResult?.total.toLocaleString("en-IN") ?? 0} receipt{currentResult?.total === 1 ? "" : "s"} <span className="text-violet-300">·</span> newest first</p></div>
                      </div>
                      <span className="shrink-0 rounded-lg bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">Page {page + 1} / {pageCount}</span>
                    </div>
                    {!visibleRows.length ? (
                      <div className="px-5 py-12 text-center"><div className="mx-auto flex size-12 items-center justify-center rounded-full bg-violet-50 text-violet-600"><WalletCards size={22} /></div><h3 className="mt-3 font-bold text-slate-800">No transactions found</h3><p className="mt-1 text-sm text-slate-500">Try another search or change the filters to see more receipts.</p></div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {visibleRows.map((row) => {
                          const paid = row.status === "Paid";
                          const failed = row.status === "Failed" || row.status === "Cancelled";
                          const refunded = row.status === "Refunded" || row.status === "Partially Refunded";
                          return (
                            <article key={row.id} className="group flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-violet-50/40 sm:gap-3 sm:px-4 sm:py-3">
                              <div className="relative size-9 shrink-0 sm:size-10">
                                <StudentAvatar
                                  studentId={row.student_id}
                                  name={row.studentName}
                                  gender={row.studentGender}
                                  size={40}
                                  className="ring-1 ring-inset"
                                />
                                <span
                                  aria-label={`Payment status: ${row.status}`}
                                  title={row.status}
                                  className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white ${paid ? "bg-emerald-500" : failed ? "bg-rose-500" : refunded ? "bg-amber-500" : "bg-violet-500"}`}
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                  <h3 className="truncate text-[12px] font-semibold text-slate-900 sm:text-[13px]">{row.studentName}</h3>
                                  <p className={`shrink-0 text-[12px] font-bold tabular-nums sm:text-[13px] ${paid ? "text-emerald-700" : failed ? "text-rose-600" : refunded ? "text-amber-700" : "text-slate-900"}`}>{money(row.amount)}</p>
                                </div>
                                <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2">
                                  <p className="min-w-0 truncate text-[10px] text-slate-500 sm:text-[11px]">{row.receipt_kind} receipt <span className="text-slate-300">·</span> {row.method} <span className="text-slate-300">·</span> {displayDate(row.payment_date)}</p>
                                  <span className={`shrink-0 text-[9px] font-semibold sm:text-[10px] ${paid ? "text-emerald-600" : failed ? "text-rose-600" : refunded ? "text-amber-700" : "text-violet-600"}`}>{row.status}</span>
                                </div>
                                {(row.refunds.length > 0 || row.pendingRefundAmount > 0) && (
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {row.refunds.length > 0 && <span className="text-[9px] font-medium text-amber-700">{row.refunds.length} refund{row.refunds.length === 1 ? "" : "s"} · {money(row.completedRefundAmount)} completed</span>}
                                    {row.pendingRefundAmount > 0 && <span className="text-[9px] font-semibold text-amber-700">Pending refund {money(row.pendingRefundAmount)}</span>}
                                  </div>
                                )}
                                <p className="mt-0.5 hidden truncate text-[9px] text-slate-400 sm:block">Ref: {row.provider_reference || row.provider_payment_id || row.id} <span className="text-slate-300">·</span> {row.branchName} <span className="text-slate-300">·</span> {row.mode === "Online" ? row.provider ?? "Online" : "Manual payment"}</p>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/70 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4"><p className="text-xs text-slate-500">Showing page {page + 1} of {pageCount} · up to {PAGE_SIZE} receipts per page</p><div className="flex items-center justify-end gap-2"><button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft size={15} />Previous</button><button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight size={15} /></button></div></div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </WorkspaceLayout>
  );
}
