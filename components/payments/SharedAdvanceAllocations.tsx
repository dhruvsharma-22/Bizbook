"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, Wallet, ReceiptText, ShieldCheck } from "lucide-react";
import StudentAvatar from "@/components/StudentAvatar";
import Link from "next/link";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  isAuthorizedTestProjectConfigured,
  loadWorkspaceBranches,
  loadWorkspaceInstitutes,
  type WorkspaceBranch,
  type WorkspaceInstitute,
} from "@/lib/supabase/workspace-scope";
import {
  mapSharedStudent,
  type SharedStudent,
  type SharedStudentRow,
  type StudentBalanceRow,
} from "@/lib/supabase/student-records";

type AdvanceBalanceRow = {
  payment_id: string;
  institute_id: string;
  branch_id: string | null;
  student_id: string;
  receipt_kind: "Advance";
  received_amount: number | string;
  available_advance: number | string;
};
type PaymentRow = {
  id: string;
  student_id: string;
  amount: number | string;
  payment_date: string;
  method: string;
  status: string;
  provider_reference: string | null;
};
type StudentOption = { student: SharedStudent; archived: boolean };
type ReceiptOption = AdvanceBalanceRow & { receipt: PaymentRow | null };
type ReadPage<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
};

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";
const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";
function paymentStatusClass(status: string): string {
  if (status === "Paid") return "bg-emerald-50 text-emerald-700";
  if (status === "Partially Refunded") return "bg-amber-50 text-amber-800";
  if (status === "Refunded") return "bg-slate-100 text-slate-600";
  return "bg-slate-100 text-slate-600";
}
const money = (value: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(Number.isFinite(value) ? value : 0);

async function readAllPages<T>(getPage: (from: number, to: number) => PromiseLike<ReadPage<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset <= 100_000; offset += 1_000) {
    const { data, error, count } = await getPage(offset, offset + 999);
    if (error) throw new Error("Shared records could not be loaded.");
    rows.push(...(data ?? []));
    if (!data?.length || data.length < 1_000 || (count !== null && rows.length >= count)) return rows;
  }
  throw new Error("More than 100,000 records match this scope. Choose a branch to narrow the list.");
}

export default function SharedAdvanceAllocations({ onUseBrowser }: { onUseBrowser?: () => void } = {}) {
  const workspaceScope = useWorkspaceScope();
  const projectAllowed = isAuthorizedTestProjectConfigured();
  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [branches, setBranches] = useState<WorkspaceBranch[]>([]);
  const [branchesInstituteId, setBranchesInstituteId] = useState("");
  const [instituteId, setInstituteId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [result, setResult] = useState<{
    scope: string;
    students: StudentOption[];
    receipts: ReceiptOption[];
  } | null>(null);
  const [scopeLoading, setScopeLoading] = useState(projectAllowed);
  const [errorResult, setErrorResult] = useState<{ scope: string; message: string } | null>(null);
  const [reloadNumber, setReloadNumber] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const next = workspaceScope.selection;
      if (!next || !institutes.some((item) => item.id === next.instituteId)) return;
      setInstituteId(next.instituteId);
      setBranchId(next.branchId);
    });
    return () => { active = false; };
  }, [institutes, workspaceScope.selection]);

  const scope = `${instituteId}|${branchId}`;
  const scopePending = workspaceScope.loading || (!!workspaceScope.selection
    && institutes.some((item) => item.id === workspaceScope.selection?.instituteId)
    && (instituteId !== workspaceScope.selection.instituteId || branchId !== workspaceScope.selection.branchId));
  const current = !scopePending && result?.scope === scope ? result : null;
  const students = useMemo(() => current?.students ?? [], [current]);
  const receipts = useMemo(() => current?.receipts ?? [], [current]);
  const selectedInstitute = institutes.find((item) => item.id === instituteId);
  const canManageRole = selectedInstitute?.role === "owner"
    || selectedInstitute?.role === "administrator"
    || selectedInstitute?.role === "accountant";
  const canManage = !scopePending && canManageRole && (selectedInstitute?.accessScope === "institute" || !!branchId);
  const currentError = errorResult?.scope === scope || errorResult?.scope === instituteId
    ? errorResult.message
    : "";
  const loading = projectAllowed && !!instituteId && canManage && (scopePending || (!current && !currentError));

  useEffect(() => {
    let active = true;
    if (!projectAllowed) return;
    void loadWorkspaceInstitutes(createSupabaseBrowserClient())
      .then((rows) => {
        if (!active) return;
        setInstitutes(rows);
        setInstituteId(rows[0]?.id ?? "");
      })
      .catch(() => {
        if (active) setErrorResult({ scope: "", message: "Institute access could not be verified. Sign in again or refresh." });
      })
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
      .catch(() => {
        if (active) setErrorResult({ scope: instituteId, message: "Accessible branches could not be loaded." });
      });
    return () => { active = false; };
  }, [instituteId, projectAllowed]);

  useEffect(() => {
    let active = true;
    if (!projectAllowed || !instituteId || !canManage) return;
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        let studentQuery = supabase.from("students")
          .select("id, institute_id, branch_id, name, gender, parent_name, parent_email, parent_email_opt_in, whatsapp_opt_in, parent_mobile, whatsapp, course, class_name, admission_date, total_fee, admission_fee, legacy_data, archived_at", { count: "exact" })
          .eq("institute_id", instituteId)
          .order("name");
        let balanceQuery = supabase.from("installment_balances")
          .select("installment_id, institute_id, branch_id, student_id, sequence_number, scheduled_amount, due_date, scheduled_status, paid_amount, outstanding_amount, balance_status, legacy_data", { count: "exact" })
          .eq("institute_id", instituteId)
          .order("sequence_number");
        let advanceQuery = supabase.from("advance_balances")
          .select("payment_id, institute_id, branch_id, student_id, receipt_kind, received_amount, available_advance", { count: "exact" })
          .eq("institute_id", instituteId);
        if (branchId) {
          studentQuery = studentQuery.eq("branch_id", branchId);
          balanceQuery = balanceQuery.eq("branch_id", branchId);
          advanceQuery = advanceQuery.eq("branch_id", branchId);
        }
        const [studentRows, balanceRows, advanceRows] = await Promise.all([
          readAllPages((from, to) => studentQuery.range(from, to)),
          readAllPages((from, to) => balanceQuery.range(from, to)),
          readAllPages((from, to) => advanceQuery.range(from, to)),
        ]);
        const receiptIds = (advanceRows as AdvanceBalanceRow[]).map((row) => row.payment_id);
        let paymentRows: PaymentRow[] = [];
        if (receiptIds.length) {
          const { data, error } = await supabase.from("payments")
            .select("id, student_id, amount, payment_date, method, status, provider_reference")
            .eq("institute_id", instituteId)
            .in("id", receiptIds);
          if (error) throw new Error("Advance receipt details are unavailable.");
          paymentRows = (data ?? []) as PaymentRow[];
        }
        if (!active) return;
        const options = (studentRows as Array<SharedStudentRow & { archived_at: string | null }>).map((row) => ({
          student: mapSharedStudent(row, balanceRows as StudentBalanceRow[]),
          archived: row.archived_at !== null,
        }));
        const byReceiptId = new Map(paymentRows.map((row) => [row.id, row]));
        setResult({
          scope,
          students: options,
          receipts: (advanceRows as AdvanceBalanceRow[])
            .map((row) => ({ ...row, receipt: byReceiptId.get(row.payment_id) ?? null }))
            .filter((row) => row.receipt !== null),
        });
        setErrorResult(null);
      } catch {
        if (active) setErrorResult({ scope, message: "Shared advance balances could not be loaded. Confirm the database migrations and finance access." });
      }
    })();
    return () => { active = false; };
  }, [branchId, canManage, instituteId, projectAllowed, reloadNumber, scope]);

  const visibleBranches = branchesInstituteId === instituteId ? branches : [];

  return (
    <WorkspaceLayout>
      <main className="min-h-screen bg-[#f2faf5] p-3 text-slate-900 sm:p-5 lg:p-7">
        <div className="mx-auto max-w-6xl space-y-5">
          <header className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-800 via-emerald-600 to-teal-600 p-4 text-white shadow-[0_12px_30px_rgba(5,150,105,0.14)] sm:p-5">
            <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-24 size-64 rounded-full border border-white/10" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 right-28 size-72 rounded-full border border-white/10" />
            <div className="relative flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[10px] font-extrabold tracking-[0.16em] text-emerald-50 backdrop-blur-sm">
                  <span className="size-2 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.15)]" />
                  BIZBOOK · ACCOUNTS
                </div>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Advance payments</h1>
                <p className="mt-1 max-w-2xl text-sm leading-5 text-emerald-50/90">Keep advance receipts organised, see how much remains available, and manage refunds from one place.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/20 pt-3 text-xs text-emerald-50">
                  <span className="inline-flex items-center gap-2"><ShieldCheck size={16} /> Institute ledger</span>
                  <span className="text-white/40">•</span>
                  <span>Receipt history and available balances</span>
                </div>
              </div>
              <div className="flex w-full flex-col gap-2 rounded-xl border border-white/20 bg-white/10 p-2.5 backdrop-blur-sm sm:p-3 lg:w-[270px] lg:shrink-0">
                <div className="flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-[0.12em] text-emerald-50/90"><ReceiptText size={15} /> Advance receipt actions</div>
                <Link href="/payments/receipt-records?workflow=advance" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm font-extrabold text-emerald-800 shadow-sm transition hover:bg-emerald-50"><Wallet size={16} /> Record advance</Link>
                <Link href="/payments/refunds?receipt=manual-advance" className="inline-flex min-h-9 items-center justify-center rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15">Refund a manual advance</Link>
                {onUseBrowser && <button type="button" onClick={onUseBrowser} className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/10"><ArrowLeft size={15} /> Browser records</button>}
              </div>
            </div>
          </header>

          {!projectAllowed && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Shared records are disabled unless this workspace targets the authorized test project.</div>}
          {currentError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{currentError}</div>}
          {scopeLoading && <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Checking institute access…</div>}
          {projectAllowed && !scopeLoading && !institutes.length && <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No active institute membership is available for this account.</div>}

          {projectAllowed && institutes.length > 0 && <section className="grid gap-3 rounded-2xl border border-emerald-100 bg-white/90 p-4 shadow-sm sm:grid-cols-2">
            {institutes.length > 1 && <label className="text-xs font-semibold text-slate-600">Institute<select className={`${inputClass} mt-1`} value={instituteId} disabled={!!workspaceScope.blocker} onChange={(event) => { const next = event.target.value; setInstituteId(next); setBranchId(""); void workspaceScope.selectInstitute(next); }}><option value="">Choose institute</option>{institutes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
            {selectedInstitute?.accessScope === "branches" && visibleBranches.length > 1 && <label className="text-xs font-semibold text-slate-600">Branch<select className={`${inputClass} mt-1`} value={branchId} onChange={(event) => { const next = event.target.value; setBranchId(next); workspaceScope.selectBranch(next); }} disabled={!instituteId || !!workspaceScope.blocker}><option value="" disabled>Choose an assigned branch</option>{visibleBranches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
            {!canManage && selectedInstitute && <p className="self-end rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{canManageRole ? "Choose an assigned branch to view advance receipts." : "Owner, administrator, or accountant access is required to view advance receipts."}</p>}
          </section>}

          {projectAllowed && instituteId && canManage && <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5"><div><h2 className="font-extrabold">Advance receipt history</h2><p className="mt-1 text-xs text-slate-500">Status and remaining balance for each advance receipt.</p></div><button type="button" onClick={() => setReloadNumber((currentNumber) => currentNumber + 1)} disabled={loading} className={secondaryButton}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button></div>
              {loading && !current ? <p className="p-5 text-sm text-slate-500">Loading advance balances…</p> : receipts.length === 0 ? <p className="p-5 text-sm text-slate-500">No advance receipts are recorded in this scope. Use Record manual advance to enter one.</p> : <div className="divide-y divide-slate-100">{receipts.map((row) => {
                const option = students.find((item) => item.student.id === row.student_id);
                const status = row.receipt?.status ?? "Unknown";
                return <article key={row.payment_id} className="flex flex-col gap-3 p-4 transition hover:bg-emerald-50/40 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div className="flex min-w-0 items-center gap-3"><div className="relative size-10 shrink-0"><StudentAvatar studentId={row.student_id} name={option?.student.name ?? "Archived student"} gender={option?.student.gender as "Male" | "Female" | "Other" | undefined} size={40} className="ring-1 ring-inset ring-emerald-100" /><span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-emerald-500" /></div><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{option?.student.name ?? "Archived student"}{option?.archived ? " · archived" : ""}</p><p className="mt-1 break-words text-xs text-slate-500">{row.receipt?.payment_date} · {row.receipt?.method}{row.receipt?.provider_reference ? ` · ${row.receipt.provider_reference}` : ""}</p></div></div><div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${paymentStatusClass(status)}`}>{status}</span><div className="min-w-[120px]"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Received</span><span className="text-sm font-semibold text-slate-700">{money(Number(row.received_amount))}</span></div><div className="min-w-[130px] rounded-xl bg-emerald-50 px-3 py-2"><span className="block text-[11px] font-semibold uppercase tracking-wide text-emerald-700/70">Available balance</span><strong className={`text-sm ${Number(row.available_advance) > 0 ? "text-emerald-800" : "text-slate-600"}`}>{money(Number(row.available_advance))}</strong></div></div></article>;
              })}</div>}
          </section>}
        </div>
      </main>
    </WorkspaceLayout>
  );
}
