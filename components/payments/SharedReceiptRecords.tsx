"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, RefreshCw, Search, Wallet, X } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import OnlineInstallmentCheckout from "@/components/payments/OnlineInstallmentCheckout";
import StudentAvatar from "@/components/StudentAvatar";
import { prepareManualReceiptPlan, type ManualReceiptKind } from "@/lib/supabase/manual-receipt";
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

type StudentOption = { student: SharedStudent; archived: boolean };
type PaymentReceiptRow = {
  id: string;
  institute_id: string;
  branch_id: string | null;
  student_id: string;
  receipt_kind: "Fee" | "Advance";
  amount: number | string;
  payment_date: string;
  method: string;
  status: "Pending" | "Processing" | "Paid" | "Failed" | "Cancelled" | "Refunded" | "Partially Refunded";
  provider_reference: string | null;
  created_at: string;
};
type PaymentTarget = { id: string; label: string; outstanding: number };
type ReadPage<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
};

const methods = ["Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Other"] as const;
const inputClass = "w-full rounded-xl border border-slate-200/90 bg-white px-3.5 py-3 text-sm text-slate-800 shadow-sm shadow-slate-900/[0.02] outline-none transition placeholder:text-slate-400 hover:border-violet-200 focus:border-violet-500 focus:ring-4 focus:ring-violet-100/80";
const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-700 via-violet-600 to-fuchsia-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-700/20 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-700/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

const money = (value: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(Number.isFinite(value) ? value : 0);

function todayLocal(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function todayInTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return todayLocal();
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : todayLocal();
  } catch {
    return todayLocal();
  }
}

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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

function safeStatus(status: PaymentReceiptRow["status"]): string {
  return status === "Paid" ? "Paid" : status === "Partially Refunded" ? "Partially refunded" : status;
}

export default function SharedReceiptRecords(props: { onUseBrowser?: () => void } = {}) {
  return (
    <Suspense fallback={<WorkspaceLayout><main className="p-4 pt-20 text-sm text-slate-600 sm:p-6">Loading payment records…</main></WorkspaceLayout>}>
      <SharedReceiptRecordsContent {...props} />
    </Suspense>
  );
}

function SharedReceiptRecordsContent(_props: { onUseBrowser?: () => void }) {
  const searchParams = useSearchParams();
  const workflow = searchParams.get("workflow");
  const receiptFormRef = useRef<HTMLFormElement>(null);
  const workspaceScope = useWorkspaceScope();
  const setWorkspaceBlocker = workspaceScope.setBlocker;
  const projectAllowed = isAuthorizedTestProjectConfigured();
  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [branches, setBranches] = useState<WorkspaceBranch[]>([]);
  const [branchesInstituteId, setBranchesInstituteId] = useState("");
  const [instituteId, setInstituteId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [dataResult, setDataResult] = useState<{ scope: string; students: StudentOption[]; receipts: PaymentReceiptRow[] } | null>(null);
  const [scopeLoading, setScopeLoading] = useState(projectAllowed);
  const [errorResult, setErrorResult] = useState<{ scope: string; message: string } | null>(null);
  const [reloadNumber, setReloadNumber] = useState(0);

  const [studentId, setStudentId] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [kind, setKind] = useState<ManualReceiptKind>(workflow === "advance" ? "Advance" : "Fee");
  const [targetId, setTargetId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [method, setMethod] = useState<(typeof methods)[number]>("Cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [today, setToday] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const idempotency = useRef<{ fingerprint: string; key: string }>({ fingerprint: "", key: "" });

  useEffect(() => {
    if (workflow !== "advance" && workflow !== "manual") return;
    const frame = window.requestAnimationFrame(() => {
      receiptFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [workflow]);

  useEffect(() => {
    setWorkspaceBlocker(Boolean(saving || studentId || targetId || amount || reference.trim() || note.trim())
      ? "Finish or clear the receipt form before switching institute or branch."
      : "");
    return () => setWorkspaceBlocker("");
  }, [amount, note, reference, saving, studentId, targetId, setWorkspaceBlocker]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const next = workspaceScope.selection;
      if (!next || !institutes.some((item) => item.id === next.instituteId)) return;
      setInstituteId(next.instituteId);
      setBranchId(next.branchId);
      setStudentId("");
      setStudentSearch("");
      setTargetId("");
    });
    return () => { active = false; };
  }, [institutes, workspaceScope.selection]);

  const scope = `${instituteId}|${branchId}`;
  const scopePending = workspaceScope.loading || (!!workspaceScope.selection
    && institutes.some((item) => item.id === workspaceScope.selection?.instituteId)
    && (instituteId !== workspaceScope.selection.instituteId || branchId !== workspaceScope.selection.branchId));
  const currentData = !scopePending && dataResult?.scope === scope ? dataResult : null;
  const students = useMemo(() => currentData?.students ?? [], [currentData]);
  const receipts = useMemo(() => currentData?.receipts ?? [], [currentData]);
  const selectedInstitute = institutes.find((item) => item.id === instituteId);
  const canRecordRole = selectedInstitute?.role === "owner" || selectedInstitute?.role === "administrator" || selectedInstitute?.role === "accountant";
  const canRecord = !scopePending && canRecordRole && (selectedInstitute?.accessScope === "institute" || !!branchId);
  const currentError = errorResult?.scope === scope || errorResult?.scope === instituteId ? errorResult.message : "";
  const loading = projectAllowed && !!instituteId && (scopePending || (!currentData && !currentError));
  const activeStudents = useMemo(() => students.filter((option) => !option.archived), [students]);
  const studentById = useMemo(() => new Map(students.map((option) => [option.student.id, option.student])), [students]);
  const selectedStudent = activeStudents.find((option) => option.student.id === studentId)?.student;
  const studentMatches = useMemo(() => {
    const query = studentSearch.trim().toLocaleLowerCase();
    if (!query || studentId) return [];
    return activeStudents.filter(({ student }) => [
      student.name,
      student.course,
      student.className,
      student.parentName,
      student.parentMobile,
    ].some((value) => value?.toLocaleLowerCase().includes(query))).slice(0, 8);
  }, [activeStudents, studentId, studentSearch]);

  const targets = useMemo<PaymentTarget[]>(() => {
    if (!selectedStudent) return [];
    const items: PaymentTarget[] = selectedStudent.installments
      .filter((item) => item.outstandingAmount > 0)
      .map((item, index) => ({
        id: item.id,
        label: `Installment ${String(index + 1).padStart(2, "0")} · balance ${money(item.outstandingAmount)}`,
        outstanding: item.outstandingAmount,
      }));
    if (selectedStudent.admissionInstallmentId && selectedStudent.admissionOutstandingAmount > 0) {
      items.unshift({
        id: selectedStudent.admissionInstallmentId,
        label: `Admission fee · balance ${money(selectedStudent.admissionOutstandingAmount)}`,
        outstanding: selectedStudent.admissionOutstandingAmount,
      });
    }
    return items;
  }, [selectedStudent]);
  const selectedTarget = targets.find((item) => item.id === targetId);

  useEffect(() => {
    let active = true;
    if (!projectAllowed) return;
    void loadWorkspaceInstitutes(createSupabaseBrowserClient())
      .then((rows) => {
        if (!active) return;
        setInstitutes(rows);
        const initialInstitute = rows[0];
        setInstituteId(initialInstitute?.id ?? "");
        const initialDate = todayInTimeZone(initialInstitute?.timeZone);
        setToday(initialDate);
        setPaymentDate((current) => current || initialDate);
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
    if (!projectAllowed || !instituteId || !canRecord) return;
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
        let receiptQuery = supabase.from("payments")
          .select("id, institute_id, branch_id, student_id, receipt_kind, amount, payment_date, method, status, provider_reference, created_at")
          .eq("institute_id", instituteId)
          .order("created_at", { ascending: false })
          .limit(100);
        if (branchId) {
          studentQuery = studentQuery.eq("branch_id", branchId);
          balanceQuery = balanceQuery.eq("branch_id", branchId);
          receiptQuery = receiptQuery.eq("branch_id", branchId);
        }
        const [studentRows, balanceRows, receiptResult] = await Promise.all([
          readAllPages((from, to) => studentQuery.range(from, to)),
          readAllPages((from, to) => balanceQuery.range(from, to)),
          receiptQuery,
        ]);
        if (receiptResult.error) throw new Error("Receipt history is unavailable for this account.");
        if (!active) return;
        const options = (studentRows as Array<SharedStudentRow & { archived_at: string | null }>).map((row) => ({
          student: mapSharedStudent(row, balanceRows as StudentBalanceRow[]),
          archived: row.archived_at !== null,
        }));
        setDataResult({ scope, students: options, receipts: (receiptResult.data ?? []) as PaymentReceiptRow[] });
        setErrorResult(null);
        const businessDate = todayInTimeZone(selectedInstitute?.timeZone);
        setToday((current) => current || businessDate);
        setPaymentDate((current) => current || businessDate);
      } catch {
        if (active) setErrorResult({ scope, message: "Shared students or receipt history could not be loaded. Confirm the database migrations and finance access." });
      }
    })();
    return () => { active = false; };
  }, [branchId, canRecord, instituteId, projectAllowed, reloadNumber, scope, selectedInstitute?.timeZone]);

  async function recordReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRecord) return;
    setMessage("");
    if (!projectAllowed || !instituteId || !canRecord || !selectedStudent) {
      setErrorResult({ scope, message: "Choose an accessible student and an authorized finance account." });
      return;
    }
    const received = Number(amount);
    let plan;
    try {
      plan = prepareManualReceiptPlan(
        kind,
        received,
        selectedTarget ? { installmentId: selectedTarget.id, outstandingAmount: selectedTarget.outstanding } : undefined,
      );
    } catch (reason) {
      setErrorResult({ scope, message: reason instanceof Error ? reason.message : "Receipt details are invalid." });
      return;
    }
    if (!paymentDate) {
      setErrorResult({ scope, message: "Choose the date the manual payment was received." });
      return;
    }
    const payloadFingerprint = JSON.stringify({
      instituteId,
      branchId: selectedStudent.branchId,
      studentId: selectedStudent.id,
      kind,
      received,
      method,
      paymentDate,
      reference: reference.trim(),
      note: note.trim(),
      allocations: plan.allocations,
    });
    if (idempotency.current.fingerprint !== payloadFingerprint) {
      idempotency.current = { fingerprint: payloadFingerprint, key: newIdempotencyKey() };
    }
    setSaving(true);
    try {
      const { data: paymentId, error: saveError } = await createSupabaseBrowserClient().rpc("record_manual_payment", {
        p_institute_id: instituteId,
        p_branch_id: selectedStudent.branchId,
        p_student_id: selectedStudent.id,
        p_receipt_kind: kind,
        p_amount: received,
        p_method: method,
        p_payment_date: paymentDate,
        p_reference: reference.trim() || null,
        p_note: note.trim() || null,
        p_allocations: plan.allocations as Json,
        p_idempotency_key: idempotency.current.key,
      });
      if (saveError) {
        setErrorResult({ scope, message: saveError.code === "42501"
          ? "Your role or branch access does not allow receipt recording."
          : saveError.code === "23514"
            ? "This balance is reserved by an active online checkout or has already been paid. Refresh the page and reconcile the checkout before recording a manual receipt."
            : "The receipt could not be recorded. Check the amount, date, and remaining balance." });
        return;
      }
      setErrorResult(null);
      let deliveryNote = "";
      if (kind === "Fee" && typeof paymentId === "string") {
        try {
          const deliveryResponse = await fetch("/api/payments/receipts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentId }),
          });
          if (deliveryResponse.ok) {
            const deliveryResult = await deliveryResponse.json() as { delivered?: Array<{ channel?: string; status?: string }> };
            const outcomes = deliveryResult.delivered ?? [];
            if (!outcomes.length) deliveryNote = " Automatic receipt delivery is paused by BizBook.";
            else if (outcomes.every((item) => item.status === "Sent")) deliveryNote = ` PDF receipt sent by ${outcomes.map((item) => item.channel).join(" and ")}.`;
            else if (outcomes.some((item) => item.status === "Skipped")) deliveryNote = " PDF receipt is ready; check guardian consent, recipient details, and company sender settings.";
            else if (outcomes.some((item) => item.status === "Failed")) deliveryNote = " PDF receipt is ready; delivery failed and can be retried.";
            else deliveryNote = " PDF receipt delivery is queued.";
          } else {
            deliveryNote = " PDF receipt is saved; company-configured delivery is queued for retry.";
          }
        } catch {
          deliveryNote = " PDF receipt is saved; company-configured delivery is queued for retry.";
        }
      }
      setMessage(plan.unallocatedAmount > 0 && plan.allocations.length > 0
        ? `Advance receipt recorded. ${money(plan.allocations[0].amount)} was allocated to the selected installment; ${money(plan.unallocatedAmount)} remains available as advance.`
          : kind === "Advance"
          ? `Advance receipt recorded once for ${money(received)}.`
          : `Fee receipt recorded once for ${money(received)}.${deliveryNote}`);
      setStudentId("");
      setStudentSearch("");
      setTargetId("");
      setAmount("");
      setReference("");
      setNote("");
      idempotency.current = { fingerprint: "", key: "" };
      setReloadNumber((current) => current + 1);
    } catch {
      setErrorResult({ scope, message: "The receipt could not be recorded. Retrying the same details is safe." });
    } finally {
      setSaving(false);
    }
  }

  const visibleBranches = branchesInstituteId === instituteId ? branches : [];
  const paidReceiptTotal = receipts.filter((receipt) => receipt.status === "Paid").reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
  const pendingReceiptCount = receipts.filter((receipt) => receipt.status === "Pending" || receipt.status === "Processing").length;

  return (
    <WorkspaceLayout>
      <main className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_rgba(124,58,237,0.09),_transparent_34%),linear-gradient(180deg,#f8f7ff_0%,#f5f7fb_48%,#f8fafc_100%)] p-3 text-slate-900 sm:p-5 lg:p-7">
        <div className="mx-auto max-w-7xl space-y-4 sm:space-y-5">
          {!projectAllowed && <div role="status" className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 text-sm font-medium text-amber-900 shadow-sm">Shared records are disabled unless this workspace targets the authorized test project.</div>}
          {currentError && <div role="alert" className="rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 to-pink-50 p-4 text-sm font-semibold text-rose-800 shadow-sm">{currentError}</div>}
          {message && <div role="status" className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4 text-sm font-semibold text-emerald-800 shadow-sm"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{message}</div>}
          {projectAllowed && instituteId && currentData && <section aria-label="Receipt overview" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="group relative overflow-hidden rounded-xl border border-violet-100/90 bg-white/90 p-3 shadow-[0_3px_12px_-8px_rgba(76,29,149,0.25)] transition hover:border-violet-200 hover:shadow-sm sm:p-3.5"><div className="absolute right-0 top-0 h-20 w-20 rounded-bl-[36px] bg-violet-50" /><div className="relative flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-500">Receipts in view</p><p className="mt-1 text-2xl font-black tracking-tight text-violet-700">{receipts.length}</p></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-100 text-violet-700"><Wallet size={19} /></span></div><p className="relative mt-2 text-[11px] text-slate-400">Latest ledger activity</p></div>
            <div className="group relative overflow-hidden rounded-xl border border-emerald-100/90 bg-white/90 p-3 shadow-[0_3px_12px_-8px_rgba(5,150,105,0.2)] transition hover:border-emerald-200 hover:shadow-sm sm:p-3.5"><div className="absolute right-0 top-0 h-20 w-20 rounded-bl-[36px] bg-emerald-50" /><div className="relative flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-500">Confirmed receipts</p><p className="mt-1 text-xl font-black tracking-tight text-emerald-700 sm:text-2xl">{money(paidReceiptTotal)}</p></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><CheckCircle2 size={19} /></span></div><p className="relative mt-2 text-[11px] text-slate-400">Paid receipts in latest rows</p></div>
            <div className="group relative overflow-hidden rounded-xl border border-amber-100/90 bg-white/90 p-3 shadow-[0_3px_12px_-8px_rgba(217,119,6,0.2)] transition hover:border-amber-200 hover:shadow-sm sm:p-3.5"><div className="absolute right-0 top-0 h-20 w-20 rounded-bl-[36px] bg-amber-50" /><div className="relative flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-500">Awaiting confirmation</p><p className="mt-1 text-2xl font-black tracking-tight text-amber-700">{pendingReceiptCount}</p></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-700"><RefreshCw size={18} /></span></div><p className="relative mt-2 text-[11px] text-slate-400">Pending or processing receipts</p></div>
          </section>}
          {scopeLoading && <div className="rounded-2xl border border-violet-100 bg-white p-5 text-sm text-slate-500 shadow-sm">Checking institute access…</div>}
          {projectAllowed && !scopeLoading && !institutes.length && <div className="rounded-2xl border border-violet-100 bg-white p-5 text-sm text-slate-600 shadow-sm">No active institute membership is available for this account.</div>}

          {projectAllowed && institutes.length > 0 && <section className="grid gap-3 sm:grid-cols-3">
            {institutes.length > 1 && <label className="text-xs font-semibold text-slate-600">Institute<select className={`${inputClass} mt-1`} value={instituteId} disabled={!!workspaceScope.blocker} onChange={(event) => { const nextId = event.target.value; setInstituteId(nextId); setBranchId(""); void workspaceScope.selectInstitute(nextId); const date = todayInTimeZone(institutes.find((item) => item.id === nextId)?.timeZone); setToday(date); setPaymentDate(date); }}><option value="">Choose institute</option>{institutes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
            {selectedInstitute?.accessScope === "branches" && visibleBranches.length > 1 && <label className="text-xs font-semibold text-slate-600">Branch<select className={`${inputClass} mt-1`} value={branchId} onChange={(event) => { setBranchId(event.target.value); workspaceScope.selectBranch(event.target.value); }} disabled={!instituteId || !!workspaceScope.blocker}><option value="" disabled>Choose an assigned branch</option>{visibleBranches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
            {!canRecord && selectedInstitute && <p className="self-end rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{canRecordRole ? "Choose an assigned branch before recording a receipt." : "Your role can’t record receipts. Owner, administrator, or accountant access is required."}</p>}
          </section>}

          {projectAllowed && instituteId && canRecord && <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-7">
            <form ref={receiptFormRef} onSubmit={recordReceipt} className="scroll-mt-24 min-w-0 overflow-hidden rounded-2xl border border-violet-200/90 bg-white shadow-[0_14px_40px_-28px_rgba(76,29,149,0.45)]">
              <div className="relative overflow-hidden bg-gradient-to-br from-violet-950 via-violet-800 to-fuchsia-800 px-4 py-5 text-white sm:px-5">
                <div className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full border border-white/10" />
                <div className="pointer-events-none absolute -bottom-16 right-20 size-40 rounded-full border border-white/10" />
                <div className="relative flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-violet-100"><Wallet size={12} /> BizBook · Accounts</p>
                    <h2 className="mt-3 text-xl font-black tracking-tight sm:text-2xl">Record a receipt</h2>
                    <p className="mt-1 max-w-sm text-xs leading-5 text-violet-100/90 sm:text-sm">Enter the payment you received and create a clear record for the student.</p>
                  </div>
                  <div className="shrink-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-right backdrop-blur-sm">
                    <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-violet-100">Receipt type</p>
                    <p className="mt-1 text-sm font-extrabold">{kind === "Fee" ? "Fee receipt" : "Advance receipt"}</p>
                    <p className="mt-1 text-[10px] text-violet-100">{paymentDate || "Date not set"}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-5 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-200/80 pb-3">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-violet-700"><span className="h-1.5 w-1.5 rounded-full bg-fuchsia-500" /> Manual entry</p>
                  <h2 className="mt-0.5 text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">Record a payment</h2>
                  <p className="mt-1 max-w-md text-xs leading-5 text-slate-500 sm:text-sm">Record money already received. A single receipt is created in the institute ledger.</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-100 bg-violet-50/80 px-2.5 py-1 text-[10px] font-bold text-violet-700"><span className="h-1.5 w-1.5 rounded-full bg-violet-600" /> Offline receipt</span>
              </div>

              <section className="space-y-3 border-b border-slate-200/80 pb-4 sm:space-y-4 sm:pb-5" aria-labelledby="manual-student-step">
                <div className="flex items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-[10px] font-extrabold text-white shadow-sm">01</span>
                  <div><h3 id="manual-student-step" className="text-sm font-bold text-slate-900">Student and receipt</h3><p className="text-xs text-slate-500">Choose who paid and how the receipt should be applied.</p></div>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-bold text-slate-700">Receipt type</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      { value: "Fee", title: "Fee receipt", description: "Apply payment to an installment." },
                      { value: "Advance", title: "Advance receipt", description: "Record funds for future fees; allocation is optional." },
                    ] as const).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={kind === option.value}
                        onClick={() => { setKind(option.value); setTargetId(""); }}
                        className={`rounded-xl border px-3 py-2.5 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:px-3.5 sm:py-3 ${kind === option.value ? "border-violet-500 bg-violet-50/80 shadow-[inset_3px_0_0_#7c3aed]" : "border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/40"}`}
                      >
                        <span className="block text-sm font-bold text-slate-900">{option.title}</span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-slate-500 sm:text-xs">{option.description}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              <div>
                <label htmlFor="manual-payment-student-search" className="block text-sm font-bold text-slate-700">Search student</label>
                <div className="relative mt-1.5">
                  <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    id="manual-payment-student-search"
                    type="text"
                    autoComplete="off"
                    required
                    className={`${inputClass} pl-10 pr-10`}
                    placeholder="Type a name, course, or parent phone"
                    value={studentSearch}
                    onChange={(event) => {
                      setStudentSearch(event.target.value);
                      setStudentId("");
                      setTargetId("");
                    }}
                  />
                  {studentSearch && (
                    <button
                      type="button"
                      onClick={() => { setStudentSearch(""); setStudentId(""); setTargetId(""); }}
                      className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                      aria-label="Clear student search or selection"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                {studentSearch.trim() && !studentId && (
                  <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg" aria-live="polite">
                    {studentMatches.length ? studentMatches.map(({ student }) => (
                      <button
                        key={student.id}
                        type="button"
                        onClick={() => { setStudentId(student.id); setStudentSearch(student.name); setTargetId(""); }}
                        className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-3 text-left last:border-b-0 hover:bg-violet-50 focus-visible:bg-violet-50 focus-visible:outline-none"
                      >
                        <StudentAvatar studentId={student.id} name={student.name} gender={student.gender} size={40} className="shrink-0" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900">{student.name}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{student.course || student.className || "Student"}{student.parentMobile ? ` · Parent phone ${student.parentMobile}` : ""}</span></span>
                      </button>
                    )) : (
                      <p className="px-3 py-3 text-sm text-slate-500">No active students match that search.</p>
                    )}
                  </div>
                )}
                {selectedStudent && <div className="mt-3 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-3"><div className="flex items-center gap-3"><StudentAvatar studentId={selectedStudent.id} name={selectedStudent.name} gender={selectedStudent.gender} size={44} className="shrink-0 ring-2 ring-white shadow-sm" /><div className="min-w-0 flex-1"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-emerald-700">Receipt for</p><p className="truncate text-sm font-extrabold text-slate-900">{selectedStudent.name}</p><p className="truncate text-xs text-slate-600">{selectedStudent.course || selectedStudent.className || "Student"}{selectedStudent.parentName ? ` · ${selectedStudent.parentName}` : ""}</p></div><CheckCircle2 size={19} className="shrink-0 text-emerald-600" /></div></div>}
              </div>
              </section>

              <section className="space-y-3 border-b border-slate-200/80 pb-4 sm:space-y-4 sm:pb-5" aria-labelledby="manual-details-step">
                <div className="flex items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-[10px] font-extrabold text-white shadow-sm">02</span>
                  <div><h3 id="manual-details-step" className="text-sm font-bold text-slate-900">Payment details</h3><p className="text-xs text-slate-500">Enter the amount, received date, and payment method.</p></div>
                </div>
              <label className="block text-sm font-bold text-slate-700">{kind === "Fee" ? "Apply fee receipt to" : "Optional advance allocation"}<select className={`${inputClass} mt-1.5`} value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={!selectedStudent} required={kind === "Fee"}><option value="">{kind === "Fee" ? "Choose an outstanding installment" : "Keep entire advance unallocated"}</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              {kind === "Advance" && selectedTarget && <p className="rounded-lg bg-violet-50 p-3 text-xs leading-5 text-violet-900">Up to {money(selectedTarget.outstanding)} will be allocated. Any excess stays available as advance; this allocation is not a second receipt.</p>}
              <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-bold text-slate-700">Amount received<span className="relative mt-1.5 block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">₹</span><input className={`${inputClass} pl-8`} required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></span></label><label className="block text-sm font-bold text-slate-700">Receipt date<input className={`${inputClass} mt-1.5`} required type="date" max={today || undefined} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label></div>
              <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-bold text-slate-700">Method<select className={`${inputClass} mt-1.5`} value={method} onChange={(event) => setMethod(event.target.value as (typeof methods)[number])}>{methods.map((item) => <option key={item}>{item}</option>)}</select></label><label className="block text-sm font-bold text-slate-700">Reference<input className={`${inputClass} mt-1.5`} maxLength={160} value={reference} onChange={(event) => setReference(event.target.value)} /></label></div>
              <label className="block text-sm font-bold text-slate-700">Note<textarea className={`${inputClass} mt-1.5`} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
              </section>

              <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-violet-700">Receipt summary</p><p className="mt-1 text-xs text-slate-600">{selectedStudent?.name || "Student name will appear here"}</p><p className="mt-0.5 text-[11px] text-slate-500">{kind === "Fee" ? (selectedTarget?.label || "Select an installment") : (selectedTarget?.label || "Advance payment")}</p></div>
                  <div className="shrink-0 text-right"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Amount received</p><p className="mt-1 text-xl font-black tracking-tight text-violet-800">{money(Number(amount) || 0)}</p></div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-violet-200 pt-3 text-[11px] text-slate-500"><span>{paymentDate || "Choose receipt date"}</span><span>{method}{reference.trim() ? ` · Ref: ${reference.trim()}` : ""}</span></div>
              </div>
              <div className="space-y-2 border-t border-violet-100 pt-4">
                <button type="submit" disabled={saving || !selectedStudent || !paymentDate || !amount || (kind === "Fee" && !targetId)} className={`${primaryButton} min-h-10 w-full sm:min-h-11`}>{saving ? "Recording payment…" : "Record manual payment"}</button>
                <p className="text-center text-[10px] leading-4 text-slate-500 sm:text-xs">Confirm the funds were received before recording. Online checkout is handled separately below.</p>
              </div>
              {kind === "Fee" && selectedStudent && selectedTarget && !selectedStudent.archivedAt && <div className="border-t border-slate-100 pt-4"><OnlineInstallmentCheckout
                instituteId={instituteId}
                instituteName={selectedInstitute?.name ?? "Coaching institute"}
                branchId={selectedStudent.branchId}
                studentId={selectedStudent.id}
                studentName={selectedStudent.name}
                parentName={selectedStudent.parentName}
                parentEmail={selectedStudent.parentEmail}
                parentMobile={selectedStudent.parentMobile}
                installmentId={selectedTarget.id}
                installmentLabel={selectedStudent.admissionInstallmentId === selectedTarget.id
                  ? "Admission fee"
                  : `Installment ${selectedStudent.installments.findIndex((item) => item.id === selectedTarget.id) + 1}`}
                amount={selectedTarget.outstanding}
                disabled={saving || loading || !canRecord}
                onConfirmed={() => setReloadNumber((current) => current + 1)}
              /></div>}
              {loading && <p role="status" className="text-xs text-slate-500">Refreshing balances and receipts…</p>}
              </div>
            </form>

            <section className="overflow-hidden rounded-[24px] border border-violet-100 bg-white shadow-[0_18px_50px_-30px_rgba(76,29,149,0.28)]">
              <div className="flex items-center justify-between gap-3 border-b border-violet-100 bg-gradient-to-r from-violet-50/80 via-white to-fuchsia-50/60 px-4 py-4 sm:px-5"><div><h2 className="font-extrabold tracking-tight text-slate-900">Recent shared receipts</h2><p className="mt-1 text-xs text-slate-500">Latest 100 payment rows in this scope</p></div><button type="button" onClick={() => setReloadNumber((current) => current + 1)} disabled={loading} className={secondaryButton}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button></div>
              {loading && !currentData ? <p className="p-5 text-sm text-slate-500">Loading receipts…</p> : receipts.length === 0 ? <p className="p-5 text-sm text-slate-500">No receipt rows were returned for this scope.</p> : <div className="divide-y divide-slate-100">{receipts.map((receipt) => <article key={receipt.id} className="flex flex-col gap-3 p-4 transition-colors hover:bg-violet-50/40 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><StudentAvatar studentId={receipt.student_id} name={studentById.get(receipt.student_id)?.name ?? "Archived student"} gender={studentById.get(receipt.student_id)?.gender} size={40} className="shrink-0" /><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{studentById.get(receipt.student_id)?.name ?? "Archived student"} · {receipt.receipt_kind} receipt</p><p className="mt-1 text-xs text-slate-500">{receipt.payment_date} · {receipt.method}{receipt.provider_reference ? ` · ${receipt.provider_reference}` : ""}</p></div></div><div className="flex items-center justify-between gap-3 sm:justify-end"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${receipt.status === "Paid" ? "bg-emerald-50 text-emerald-700" : receipt.status === "Failed" || receipt.status === "Cancelled" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{safeStatus(receipt.status)}</span><strong className="text-sm text-slate-900">{money(Number(receipt.amount))}</strong></div></article>)}</div>}
            </section>
          </div>}
        </div>
      </main>
    </WorkspaceLayout>
  );
}
