"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";
import {
  getRefundableReceiptPaise,
  matchesRefundReceiptFilter,
  prepareManualRefundPlan,
  type RefundReceiptFilter,
} from "@/lib/supabase/refund-operations";
import {
  isAuthorizedTestProjectConfigured,
  loadWorkspaceInstitutes,
  type WorkspaceInstitute,
} from "@/lib/supabase/workspace-scope";

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
  status: "Pending" | "Processing" | "Paid" | "Failed" | "Cancelled" | "Refunded" | "Partially Refunded";
  provider_reference?: string | null;
  provider: "razorpay" | "cashfree" | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
};
type RefundRow = {
  id: string;
  institute_id: string;
  branch_id: string | null;
  payment_id: string;
  student_id: string;
  amount: number | string;
  status: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled";
  reason: string;
  mode: "Manual" | "Online";
  provider_refund_reference: string | null;
  created_at: string;
};
type AllocationRow = { id: string; payment_id: string; amount: number | string };
type RefundAllocationRow = { refund_id: string; payment_id: string; payment_allocation_id: string; amount: number | string };
type StudentRow = { id: string; institute_id: string; branch_id: string | null; name: string; archived_at: string | null };
type ReadPage<T> = { data: T[] | null; error: { message: string } | null; count: number | null };
type RefundData = {
  scope: string;
  payments: PaymentRow[];
  refunds: RefundRow[];
  allocations: AllocationRow[];
  refundAllocations: RefundAllocationRow[];
  students: StudentRow[];
};

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";
const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";
const reservingStatuses = new Set(["Pending", "Processing", "Completed"]);
const money = (value: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(Number.isFinite(value) ? value : 0);

function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `refund-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readAllPages<T>(getPage: (from: number, to: number) => PromiseLike<ReadPage<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset <= 100_000; offset += 1_000) {
    const { data, error, count } = await getPage(offset, offset + 999);
    if (error) throw new Error("Shared records could not be loaded.");
    rows.push(...(data ?? []));
    if (!data?.length || data.length < 1_000 || (count !== null && rows.length >= count)) return rows;
  }
  throw new Error("More than 100,000 records match this scope. Narrow the list by selecting a smaller institute scope.");
}

function statusStyle(status: RefundRow["status"]): string {
  if (status === "Completed") return "bg-emerald-50 text-emerald-700";
  if (status === "Pending" || status === "Processing") return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

export default function SharedRefundRecords(props: { onUseBrowser: () => void }) {
  return (
    <Suspense fallback={<WorkspaceLayout><main className="p-4 pt-20 text-sm text-slate-600 sm:p-6">Loading refund records…</main></WorkspaceLayout>}>
      <RefundSearchParamsGate {...props} />
    </Suspense>
  );
}

function RefundSearchParamsGate({ onUseBrowser }: { onUseBrowser: () => void }) {
  const searchParams = useSearchParams();
  const initialReceiptFilter: RefundReceiptFilter = searchParams.get("receipt") === "manual-advance"
    ? "manual-advance"
    : "all";
  return <SharedRefundRecordsContent key={initialReceiptFilter} onUseBrowser={onUseBrowser} initialReceiptFilter={initialReceiptFilter} />;
}

function SharedRefundRecordsContent({ onUseBrowser: _onUseBrowser, initialReceiptFilter }: {
  onUseBrowser: () => void;
  initialReceiptFilter: RefundReceiptFilter;
}) {
  const refundFormRef = useRef<HTMLFormElement>(null);
  const refundHistoryRef = useRef<HTMLElement>(null);
  const [newlyRecordedRefundId, setNewlyRecordedRefundId] = useState("");
  const [newlyRecordedPaymentId, setNewlyRecordedPaymentId] = useState("");
  const workspaceScope = useWorkspaceScope();
  const setWorkspaceBlocker = workspaceScope.setBlocker;
  const projectAllowed = isAuthorizedTestProjectConfigured();
  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [instituteId, setInstituteId] = useState("");
  const [dataResult, setDataResult] = useState<RefundData | null>(null);
  const [scopeLoading, setScopeLoading] = useState(projectAllowed);
  const [errorResult, setErrorResult] = useState<{ scope: string; message: string } | null>(null);
  const [reloadNumber, setReloadNumber] = useState(0);

  const [paymentId, setPaymentId] = useState("");
  const [receiptSearch, setReceiptSearch] = useState("");
  const [receiptFilter, setReceiptFilter] = useState<RefundReceiptFilter>(initialReceiptFilter);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingRefundId, setSavingRefundId] = useState("");
  const [message, setMessage] = useState("");
  const requestKey = useRef<{ fingerprint: string; id: string }>({ fingerprint: "", id: "" });

  useEffect(() => {
    if (initialReceiptFilter !== "manual-advance") return;
    const frame = window.requestAnimationFrame(() => {
      refundFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialReceiptFilter]);

  useEffect(() => {
    setWorkspaceBlocker(Boolean(saving || paymentId || amount || reason.trim())
      ? "Finish or clear the refund request before switching institute."
      : "");
    return () => setWorkspaceBlocker("");
  }, [amount, paymentId, reason, saving, setWorkspaceBlocker]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const next = workspaceScope.selection;
      if (!next || !institutes.some((item) => item.id === next.instituteId)) return;
      setInstituteId(next.instituteId);
      setPaymentId("");
      setReceiptSearch("");
    });
    return () => { active = false; };
  }, [institutes, workspaceScope.selection]);

  const scope = instituteId;
  const scopePending = workspaceScope.loading || (!!workspaceScope.selection
    && institutes.some((item) => item.id === workspaceScope.selection?.instituteId)
    && instituteId !== workspaceScope.selection.instituteId);
  const current = !scopePending && dataResult?.scope === scope ? dataResult : null;
  const selectedInstitute = institutes.find((item) => item.id === instituteId);
  const canManageRole = selectedInstitute?.role === "owner"
    || selectedInstitute?.role === "administrator"
    || selectedInstitute?.role === "accountant";
  const canManage = !scopePending && canManageRole;
  const canReadScope = canManage;
  const currentError = errorResult?.scope === scope || errorResult?.scope === instituteId
    ? errorResult.message
    : "";
  const loading = projectAllowed && !!instituteId && canReadScope && (scopePending || (!current && !currentError));
  const studentsById = useMemo(() => new Map((current?.students ?? []).map((student) => [student.id, student])), [current]);
  const selectedPayment = current?.payments.find((payment) => payment.id === paymentId);
  const selectedRefunds = current?.refunds.filter((refund) => refund.payment_id === paymentId) ?? [];
  const selectedAllocations = current?.allocations.filter((allocation) => allocation.payment_id === paymentId) ?? [];
  const reservedByAllocation = new Map<string, number>();
  const reservedByAllocationPaise = new Map<string, number>();
  let invalidReservedAllocation = false;
  if (current) {
    const activeRefundIds = new Set(current.refunds
      .filter((refund) => refund.payment_id === paymentId && reservingStatuses.has(refund.status))
      .map((refund) => refund.id));
    current.refundAllocations
      .filter((allocation) => allocation.payment_id === paymentId && activeRefundIds.has(allocation.refund_id))
      .forEach((allocation) => {
        const amountPaise = parseAmountInputToPaise(String(allocation.amount));
        if (amountPaise === null || amountPaise <= 0) {
          invalidReservedAllocation = true;
          return;
        }
        const previousPaise = reservedByAllocationPaise.get(allocation.payment_allocation_id) ?? 0;
        const totalPaise = previousPaise + amountPaise;
        if (!Number.isSafeInteger(totalPaise)) {
          invalidReservedAllocation = true;
          return;
        }
        reservedByAllocationPaise.set(allocation.payment_allocation_id, totalPaise);
      });
  }
  for (const [allocationId, amountPaise] of reservedByAllocationPaise) {
    reservedByAllocation.set(allocationId, amountPaise / 100);
  }
  let selectedRefundable: number | null = null;
  if (selectedPayment && !invalidReservedAllocation) {
    try { selectedRefundable = getRefundableReceiptPaise(selectedPayment.amount, selectedRefunds) / 100; }
    catch { selectedRefundable = null; }
  }
  const refundable = selectedRefundable ?? 0;
  const refundOptionResults = (current?.payments ?? [])
    .filter((payment) => ["Paid", "Partially Refunded"].includes(payment.status)
      && (payment.mode === "Manual" || (payment.mode === "Online" && payment.provider
        && payment.provider_order_id && payment.provider_payment_id)))
    .map((payment) => {
      try {
        return { valid: true as const, payment, refundable: getRefundableReceiptPaise(
          payment.amount,
          current?.refunds.filter((refund) => refund.payment_id === payment.id) ?? [],
        ) / 100 };
      } catch {
        return { valid: false as const, payment };
      }
    });
  const invalidRefundPaymentCount = refundOptionResults.filter((item) => !item.valid).length
    + (invalidReservedAllocation ? 1 : 0);
  const refundOptions = refundOptionResults
    .filter((item): item is Extract<typeof item, { valid: true }> => item.valid && item.refundable > 0)
    .map(({ payment, refundable: amountLeft }) => ({ payment, refundable: amountLeft }))
    .filter(({ payment }) => matchesRefundReceiptFilter(payment, receiptFilter));
  const receiptMatches = useMemo(() => {
    const query = receiptSearch.trim().toLocaleLowerCase();
    if (!query || paymentId) return [];
    return refundOptions.filter(({ payment, refundable: amountLeft }) => {
      const studentName = studentsById.get(payment.student_id)?.name ?? "Student";
      const searchableValues = [
        studentName,
        payment.mode,
        payment.receipt_kind,
        payment.payment_date,
        payment.method,
        payment.provider_reference ?? "",
        payment.provider ?? "",
        payment.provider_order_id ?? "",
        payment.provider_payment_id ?? "",
        money(Number(payment.amount)),
        money(amountLeft),
      ];
      return searchableValues.some((value) => value.toLocaleLowerCase().includes(query));
    }).slice(0, 10);
  }, [paymentId, receiptSearch, refundOptions, studentsById]);
  const selectedReceiptLabel = selectedPayment
    ? `${studentsById.get(selectedPayment.student_id)?.name ?? "Student"} · ${selectedPayment.mode} · ${selectedPayment.receipt_kind} · ${selectedPayment.payment_date}`
    : "";

  useEffect(() => {
    let active = true;
    if (!projectAllowed) return;
    void loadWorkspaceInstitutes(createSupabaseBrowserClient())
      .then((rows) => {
        if (!active) return;
        setInstitutes(rows);
        setInstituteId(rows[0]?.id ?? "");
      })
      .catch(() => { if (active) setErrorResult({ scope: "", message: "Institute access could not be verified. Sign in again or refresh." }); })
      .finally(() => { if (active) setScopeLoading(false); });
    return () => { active = false; };
  }, [projectAllowed]);

  useEffect(() => {
    let active = true;
    if (!projectAllowed || !instituteId || !canReadScope) return;
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        let paymentQuery = supabase.from("payments")
          .select("id, institute_id, branch_id, student_id, receipt_kind, amount, payment_date, method, mode, status, provider_reference, provider, provider_order_id, provider_payment_id", { count: "exact" })
          .eq("institute_id", instituteId)
          .in("status", ["Paid", "Partially Refunded"])
          .order("payment_date", { ascending: false });
        let refundQuery = supabase.from("refunds")
          .select("id, institute_id, branch_id, payment_id, student_id, amount, status, reason, mode, provider_refund_reference, created_at", { count: "exact" })
          .eq("institute_id", instituteId)
          .order("created_at", { ascending: false });
        let studentQuery = supabase.from("students")
          .select("id, institute_id, branch_id, name, archived_at", { count: "exact" })
          .eq("institute_id", instituteId)
          .order("name");
        const [payments, refunds, allocations, refundAllocations, students] = await Promise.all([
          readAllPages((from, to) => paymentQuery.range(from, to)),
          readAllPages((from, to) => refundQuery.range(from, to)),
          readAllPages((from, to) => supabase.from("payment_allocations")
            .select("id, payment_id, amount", { count: "exact" })
            .eq("institute_id", instituteId)
            .range(from, to)),
          readAllPages((from, to) => supabase.from("refund_allocations")
            .select("refund_id, payment_id, payment_allocation_id, amount", { count: "exact" })
            .eq("institute_id", instituteId)
            .range(from, to)),
          readAllPages((from, to) => studentQuery.range(from, to)),
        ]);
        if (!active) return;
        setDataResult({
          scope,
          payments: payments as PaymentRow[],
          refunds: refunds as RefundRow[],
          allocations: allocations as AllocationRow[],
          refundAllocations: refundAllocations as RefundAllocationRow[],
          students: students as StudentRow[],
        });
        setErrorResult(null);
      } catch {
        if (active) setErrorResult({ scope, message: "Shared refund history could not be loaded. Confirm the database migrations and finance access." });
      }
    })();
    return () => { active = false; };
  }, [canReadScope, instituteId, projectAllowed, reloadNumber, scope]);

  async function requestManualRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!projectAllowed || !instituteId || !canReadScope || !selectedPayment || selectedRefundable === null) {
      setErrorResult({ scope, message: "Choose an eligible receipt in an authorized institute." });
      return;
    }
    let plan;
    try {
      plan = prepareManualRefundPlan({
        amount: Number(amount),
        paymentAmount: selectedPayment.amount,
        reason,
        refunds: selectedRefunds,
        allocations: selectedAllocations,
        reservedByAllocationId: reservedByAllocation,
      });
    } catch (error) {
      setErrorResult({ scope, message: error instanceof Error ? error.message : "Refund details are invalid." });
      return;
    }
    if (selectedPayment.mode === "Online" && !window.confirm(
      `Initiate a ${money(plan.amount)} refund through the ${selectedPayment.provider} TEST environment? This sends a refund request to the provider sandbox; confirm only if this test refund is intended.`,
    )) return;

    const fingerprint = JSON.stringify({ instituteId, paymentId, amount: plan.amount, reason: plan.reason, breakdown: plan.allocationBreakdown });
    if (requestKey.current.fingerprint !== fingerprint) requestKey.current = { fingerprint, id: newId() };
    const refundId = requestKey.current.id;
    setSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const isOnline = selectedPayment.mode === "Online";
      const { data: requestResult, error } = isOnline
        ? await supabase.rpc("request_online_refund", {
          p_payment_id: selectedPayment.id,
          p_amount: plan.amount,
          p_reason: plan.reason,
          p_allocation_breakdown: plan.allocationBreakdown as Json,
          p_refund_id: refundId,
        })
        : await supabase.rpc("request_refund", {
          p_payment_id: selectedPayment.id,
          p_amount: plan.amount,
          p_reason: plan.reason,
          p_mode: "Manual",
          p_allocation_breakdown: plan.allocationBreakdown as Json,
          p_refund_id: refundId,
        });
      const expectedMode = isOnline ? "Online" : "Manual";
      let requestConfirmed = !error;
      if (error) {
        const { data: existing } = await supabase.from("refunds")
          .select("id, payment_id, amount, reason, mode")
          .eq("institute_id", instituteId)
          .eq("id", refundId)
          .maybeSingle();
        if (!existing || existing.payment_id !== selectedPayment.id
          || Number(existing.amount) !== plan.amount || existing.reason !== plan.reason || existing.mode !== expectedMode) {
          setErrorResult({ scope, message: error.code === "42501"
            ? "Your role does not allow refund requests."
            : "The refund request was rejected. Refresh the refundable balance before trying again." });
          setDataResult(null);
          setReloadNumber((currentNumber) => currentNumber + 1);
          return;
        }
        requestConfirmed = true;
      }
      if (isOnline && (!requestConfirmed || !requestResult || typeof requestResult !== "object")) {
        setErrorResult({ scope, message: "The provider refund request could not be confirmed. Refresh refund history before retrying." });
        setDataResult(null);
        setReloadNumber((currentNumber) => currentNumber + 1);
        return;
      }

      setAmount("");
      setReason("");
      setPaymentId("");
      setReceiptSearch("");
      requestKey.current = { fingerprint: "", id: "" };
      setDataResult(null);
      setReloadNumber((currentNumber) => currentNumber + 1);
      if (isOnline) {
        const response = await fetch("/api/payments/refunds/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refundId }),
        });
        const result = await response.json().catch(() => null) as { message?: string; error?: string; status?: string } | null;
        if (!response.ok) {
          setErrorResult({ scope, message: `Refund ${refundId} is reserved and remains pending. ${result?.error ?? "Provider status is not confirmed."} Retry from refund history after checking the provider.` });
          return;
        }
        setErrorResult(null);
        setMessage(result?.message ?? `Provider refund ${refundId} is recorded as ${result?.status ?? "pending"}.`);
        return;
      }
      setErrorResult(null);
      setNewlyRecordedRefundId(refundId);
      setNewlyRecordedPaymentId(selectedPayment.id);
      window.requestAnimationFrame(() => refundHistoryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      setMessage(`Refund request ${refundId} is recorded as pending. Confirm it only after the money has actually been returned to the student.`);
    } catch {
      setErrorResult({ scope, message: "The request result could not be confirmed. Refresh the refund history before retrying." });
      setDataResult(null);
      setReloadNumber((currentNumber) => currentNumber + 1);
    } finally {
      setSaving(false);
    }
  }

  async function completeManualRefund(refund: RefundRow) {
    if (!canReadScope || scopePending) return;
    const confirmed = window.confirm(`Have you already returned ${money(Number(refund.amount))} to the student using your manual payment method? Confirm only after the money has actually been returned.`);
    if (!confirmed) return;
    setSavingRefundId(refund.id);
    setErrorResult(null);
    try {
      const { error } = await createSupabaseBrowserClient().rpc("complete_manual_refund", { p_refund_id: refund.id });
      if (error) {
        setErrorResult({ scope, message: error.code === "42501"
          ? "Your role does not allow refund completion."
          : "The refund was not marked completed. Refresh its status and check the actual return first." });
        setDataResult(null);
        setReloadNumber((currentNumber) => currentNumber + 1);
        return;
      }
      setMessage(`Manual refund ${refund.id} is recorded as completed after your confirmation.`);
      setNewlyRecordedRefundId((currentId) => currentId === refund.id ? "" : currentId);
      setNewlyRecordedPaymentId((currentId) => currentId === refund.payment_id ? "" : currentId);
      setDataResult(null);
      setReloadNumber((currentNumber) => currentNumber + 1);
    } catch {
      setErrorResult({ scope, message: "Refund completion could not be confirmed. Refresh its status before trying again." });
      setDataResult(null);
      setReloadNumber((currentNumber) => currentNumber + 1);
    } finally {
      setSavingRefundId("");
    }
  }

  async function processOnlineRefund(refund: RefundRow) {
    if (!canReadScope || scopePending || refund.mode !== "Online"
      || !["Pending", "Processing"].includes(refund.status)) return;
    if (!refund.provider_refund_reference && !window.confirm(
      `Submit the reserved ${money(Number(refund.amount))} refund to the provider TEST environment? This may initiate a real refund within the sandbox.`,
    )) return;
    setSavingRefundId(refund.id);
    setErrorResult(null);
    setMessage("");
    try {
      const response = await fetch("/api/payments/refunds/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refundId: refund.id }),
      });
      const result = await response.json().catch(() => null) as { message?: string; error?: string; status?: string } | null;
      if (!response.ok) {
        setErrorResult({ scope, message: result?.error ?? "The provider refund status could not be confirmed. The reservation remains pending." });
      } else {
        setMessage(result?.message ?? `Provider refund is recorded as ${result?.status ?? "pending"}.`);
      }
      setDataResult(null);
      setReloadNumber((currentNumber) => currentNumber + 1);
    } catch {
      setErrorResult({ scope, message: "Provider refund status could not be confirmed. The reserved amount remains pending; refresh before retrying." });
      setDataResult(null);
      setReloadNumber((currentNumber) => currentNumber + 1);
    } finally {
      setSavingRefundId("");
    }
  }

  const allRefunds = current?.refunds ?? [];

  useEffect(() => {
    if (!newlyRecordedRefundId && !newlyRecordedPaymentId) return;
    const recordedRefund = current?.refunds.find((refund) =>
      refund.id === newlyRecordedRefundId || refund.payment_id === newlyRecordedPaymentId,
    );
    const frame = window.requestAnimationFrame(() => {
      if (recordedRefund) {
        document.getElementById(`refund-${recordedRefund.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        refundHistoryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [current, newlyRecordedPaymentId, newlyRecordedRefundId]);

  return (
    <WorkspaceLayout>
      <style jsx global>{`
        @keyframes refundConfirmBlink {
          0%, 100% { background-color: #dc2626; box-shadow: 0 0 0 4px rgba(254, 202, 202, 0.85); transform: scale(1); opacity: 1; }
          50% { background-color: #991b1b; box-shadow: 0 0 0 7px rgba(248, 113, 113, 0.28); transform: scale(1.025); opacity: 0.82; }
        }
        .refund-confirm-blink { animation: refundConfirmBlink 0.85s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .refund-confirm-blink { animation: none; } }
      `}</style>
      <main className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_rgba(16,185,129,0.08),_transparent_34%),linear-gradient(180deg,#f7fbf8_0%,#f3f7f8_52%,#f8fafc_100%)] p-3 text-slate-900 sm:p-5 lg:p-7">
        <div className="mx-auto max-w-7xl space-y-4 sm:space-y-5">

          {!projectAllowed && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Shared records are disabled unless this workspace targets the authorized test project.</div>}
          {currentError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{currentError}</div>}
          {invalidRefundPaymentCount > 0 && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Refund options for {invalidRefundPaymentCount} receipt(s) are disabled because a stored receipt, refund reservation, or allocation has invalid monetary precision. Refresh and reconcile the ledger before requesting a refund.</div>}
          {message && <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{message}</div>}
          {scopeLoading && <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Checking institute access…</div>}
          {projectAllowed && !scopeLoading && !institutes.length && <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No active institute membership is available for this account.</div>}

          {projectAllowed && institutes.length > 0 && <section className="grid gap-3 sm:grid-cols-2">
            {institutes.length > 1 && <label className="text-xs font-semibold text-slate-600">Institute<select className={`${inputClass} mt-1`} value={instituteId} disabled={!!workspaceScope.blocker} onChange={(event) => { const next = event.target.value; setInstituteId(next); setPaymentId(""); setReceiptSearch(""); void workspaceScope.selectInstitute(next); }}><option value="">Choose institute</option>{institutes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
            {!canManageRole && selectedInstitute && <p className="self-end rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Owner, administrator, or accountant access is required for refund operations.</p>}
          </section>}

          {projectAllowed && instituteId && canReadScope && <>
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-7">
              <form ref={refundFormRef} onSubmit={requestManualRefund} className="scroll-mt-24 min-w-0 overflow-hidden rounded-2xl border border-emerald-200/90 bg-white shadow-[0_14px_40px_-28px_rgba(5,150,105,0.32)]">
                <div className="relative overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-800 to-teal-700 px-4 py-5 text-white sm:px-5">
                  <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full border border-white/10" />
                  <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 right-20 size-40 rounded-full border border-white/10" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-100"><RotateCcw size={12} /> BizBook · Accounts</p>
                      <h2 className="mt-3 text-xl font-black tracking-tight sm:text-2xl">Record a refund</h2>
                      <p className="mt-1 max-w-sm text-xs leading-5 text-emerald-100/90 sm:text-sm">Record a refund request against a receipt and track it until the money is returned.</p>
                    </div>
                    <div className="shrink-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-right backdrop-blur-sm">
                      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-100">Refund type</p>
                      <p className="mt-1 text-sm font-extrabold">{receiptFilter === "manual-advance" ? "Advance refund" : receiptFilter === "manual-fee" ? "Fee refund" : receiptFilter === "online" ? "Online refund" : "All receipts"}</p>
                      <p className="mt-1 text-[10px] text-emerald-100">Pending until confirmed</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200/80 pb-3">
                    <div>
                      <p className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Refund entry</p>
                      <h3 className="mt-0.5 text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">Record a refund</h3>
                      <p className="mt-1 max-w-md text-xs leading-5 text-slate-500 sm:text-sm">Choose the original receipt, enter the amount, and record the reason.</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /> Refund request</span>
                  </div>
                <label className="block text-sm font-bold text-slate-700">Receipt type<select className={`${inputClass} mt-1.5`} value={receiptFilter} onChange={(event) => { setReceiptFilter(event.target.value as RefundReceiptFilter); setPaymentId(""); setReceiptSearch(""); setAmount(""); requestKey.current = { fingerprint: "", id: "" }; }}><option value="all">All refundable receipts</option><option value="manual-fee">Manual fee receipts</option><option value="manual-advance">Manual advance receipts</option><option value="online">Online receipts</option></select></label>
                <div>
                  <label htmlFor="refund-receipt-search" className="block text-sm font-bold text-slate-700">Search receipt</label>
                  <div className="relative mt-1.5">
                    <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      id="refund-receipt-search"
                      type="text"
                      autoComplete="off"
                      required
                      className={`${inputClass} pl-10 pr-10`}
                      placeholder="Search student, date, method, or reference"
                      value={receiptSearch}
                      onChange={(event) => {
                        setReceiptSearch(event.target.value);
                        setPaymentId("");
                        setAmount("");
                        requestKey.current = { fingerprint: "", id: "" };
                      }}
                    />
                    {receiptSearch && (
                      <button
                        type="button"
                        onClick={() => { setReceiptSearch(""); setPaymentId(""); setAmount(""); requestKey.current = { fingerprint: "", id: "" }; }}
                        className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                        aria-label="Clear receipt search or selection"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  {receiptSearch.trim() && !paymentId && (
                    <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg" aria-live="polite">
                      {receiptMatches.length ? receiptMatches.map(({ payment, refundable: amountLeft }) => {
                        const studentName = studentsById.get(payment.student_id)?.name ?? "Student";
                        return (
                          <button
                            key={payment.id}
                            type="button"
                            onClick={() => {
                              setPaymentId(payment.id);
                              setReceiptSearch(`${studentName} · ${payment.mode} · ${payment.receipt_kind} · ${payment.payment_date}`);
                              setAmount("");
                              requestKey.current = { fingerprint: "", id: "" };
                            }}
                            className="flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-emerald-50 focus-visible:bg-emerald-50 focus-visible:outline-none"
                          >
                            <span className="text-sm font-semibold text-slate-900">{studentName} · {payment.receipt_kind} receipt</span>
                            <span className="text-xs text-slate-500">{payment.mode} · {payment.payment_date} · refundable {money(amountLeft)}{payment.method ? ` · ${payment.method}` : ""}</span>
                          </button>
                        );
                      }) : (
                        <p className="px-3 py-3 text-sm text-slate-500">No refundable receipts match that search.</p>
                      )}
                    </div>
                  )}
                  {selectedPayment && <p className="mt-1.5 text-xs font-medium text-emerald-700">Selected: {selectedReceiptLabel}</p>}
                </div>
                {selectedPayment && <p className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">Receipt amount: {money(Number(selectedPayment.amount))}. Remaining refundable: {money(refundable)}. Existing pending/processing requests reserve balance; only completed refunds reduce collections.</p>}
                <label className="block text-sm font-bold text-slate-700">Refund amount<input className={`${inputClass} mt-1.5`} required type="number" min={selectedPayment?.mode === "Online" && selectedPayment.provider === "razorpay" ? "1.00" : "0.01"} step="0.01" max={refundable || undefined} value={amount} onChange={(event) => setAmount(event.target.value)} disabled={!selectedPayment} /></label>
                <label className="block text-sm font-bold text-slate-700">Reason<textarea className={`${inputClass} mt-1.5`} required minLength={1} maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                <button type="submit" disabled={saving || !selectedPayment || !amount || !reason.trim()} className={`${primaryButton} w-full`}>{saving ? "Submitting…" : selectedPayment?.mode === "Online" ? "Record and submit test refund" : selectedPayment?.receipt_kind === "Advance" ? "Record advance refund request" : "Record refund request"}</button>
                <p className="text-xs leading-5 text-slate-500">Online requests require a verified test-mode connection and server Vault access. A refund stays pending until its completion is confirmed by the appropriate process.</p>
                </div>
              </form>

              <section ref={refundHistoryRef} className="min-w-0 scroll-mt-6 overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-[0_14px_40px_-30px_rgba(5,150,105,0.24)]">
                <div className="flex items-center justify-between gap-3 border-b border-emerald-100 bg-gradient-to-r from-emerald-50/80 via-white to-teal-50/60 px-4 py-4 sm:px-5"><div><h2 className="font-extrabold tracking-tight text-slate-900">Refund history</h2><p className="mt-1 text-xs text-slate-500">Latest refund requests in this scope</p><p className="mt-2 max-w-lg rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-900">After recording a refund, use “Confirm money returned” only after the money has actually been returned to the student.</p></div><button type="button" onClick={() => { setDataResult(null); setReloadNumber((currentNumber) => currentNumber + 1); }} disabled={loading} className={secondaryButton}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button></div>
                {loading && !current ? <p className="p-5 text-sm text-slate-500">Loading refund history…</p> : allRefunds.length === 0 ? <p className="p-5 text-sm text-slate-500">No shared refund requests exist in this scope.</p> : <div className="divide-y divide-slate-100">{allRefunds.map((refund) => {
                  const student = studentsById.get(refund.student_id);
                  const canComplete = refund.mode === "Manual" && ["Pending", "Processing"].includes(refund.status);
                  const canProcessOnline = refund.mode === "Online" && ["Pending", "Processing"].includes(refund.status);
                  const isJustRecorded = newlyRecordedRefundId === refund.id || (!!newlyRecordedPaymentId && refund.payment_id === newlyRecordedPaymentId);
                  return <article id={`refund-${refund.id}`} key={refund.id} className={`flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-start sm:justify-between ${isJustRecorded ? "bg-red-50/80 ring-1 ring-inset ring-red-100" : ""}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-bold text-slate-800">{student?.name ?? "Student"}{student?.archived_at ? " · archived" : ""}</p><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(refund.status)}`}>{refund.status}</span></div><p className="mt-1 text-xs text-slate-500">{refund.mode} · requested {new Date(refund.created_at).toLocaleString("en-IN")}</p>{refund.provider_refund_reference && <p className="mt-1 break-all font-mono text-[11px] text-slate-500">Provider refund: {refund.provider_refund_reference}</p>}<p className="mt-1 text-xs leading-5 text-slate-600">{refund.reason}</p><p className="mt-1 font-bold text-slate-900">{money(Number(refund.amount))}</p></div>{canComplete && <button type="button" onClick={() => void completeManualRefund(refund)} disabled={savingRefundId === refund.id} className={isJustRecorded ? "refund-confirm-blink inline-flex animate-pulse items-center justify-center gap-1.5 rounded-lg border border-red-700 bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm shadow-red-200 ring-2 ring-red-100 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-50" : secondaryButton}>{savingRefundId === refund.id ? "Saving…" : "Confirm money returned"}</button>}{canProcessOnline && <button type="button" onClick={() => void processOnlineRefund(refund)} disabled={savingRefundId === refund.id || !canReadScope || scopePending} className={secondaryButton}>{savingRefundId === refund.id ? "Checking…" : refund.provider_refund_reference ? "Check provider status" : "Submit or retry test refund"}</button>}</article>;
                })}</div>}
              </section>
            </div>
          </>}
        </div>
      </main>
    </WorkspaceLayout>
  );
}
