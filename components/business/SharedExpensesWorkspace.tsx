"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle, ArrowUpRight, CalendarClock, CheckCircle2, CircleDollarSign, Plus, RefreshCw, ReceiptText, Search, X } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { dateInTimeZone } from "@/lib/business-date";

type Expense = {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  method: string | null;
  notes: string;
  recurring_rule_id?: string | null;
  recurring_due_month?: string | null;
  payment_status: "paid" | "unpaid";
  payment_due_date: string | null;
  paid_at: string | null;
};
type ExpenseForm = {
  title: string; category: string; amount: number; date: string; method: string;
  notes: string; paymentStatus: "paid" | "unpaid"; paymentDueDate: string; paidAt: string;
};
type ApiExpense = {
  id: string;
  title: string;
  category: string;
  amount: number | string;
  expense_date: string;
  method: string | null;
  notes: string | null;
  recurring_rule_id?: string | null;
  recurring_due_month?: string | null;
  payment_status: "paid" | "unpaid";
  payment_due_date: string | null;
  paid_at: string | null;
};
type ExpenseListResponse = {
  expenses?: ApiExpense[];
  totalCount?: number;
  hasMore?: boolean;
  summary?: { monthTotal: number; expenseCount: number };
  error?: string;
};
type RecurringRule = {
  id: string;
  institute_id: string;
  branch_id: string | null;
  title: string;
  category: string;
  amount: number | string;
  default_method: string;
  due_day: number;
  start_month: string;
  ends_on: string | null;
  notes: string | null;
};
type RecurringOccurrence = {
  ruleId: string;
  title: string;
  category: string;
  amount: number;
  defaultMethod: string;
  dueDay: number;
  dueMonth: string;
  dueDate: string;
  ruleActive: boolean;
  status: "overdue" | "due_today" | "upcoming" | "paid";
  expenseId: string | null;
  canRecord: boolean;
};
type RecurringResponse = { today?: string; rules?: RecurringRule[]; occurrences?: RecurringOccurrence[]; unpaidExpenses?: ApiExpense[]; error?: string };

const CATEGORIES = ["Rent", "Utilities", "Supplies", "Maintenance", "Travel", "Marketing", "Other"];
const METHODS = ["Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Other"];
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-xl bg-[#08734f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#075c40] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryClass = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:border-emerald-200 hover:bg-emerald-50/60 disabled:opacity-50";
const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
const mapExpense = (row: ApiExpense): Expense => ({
  id: row.id,
  title: row.title,
  category: row.category,
  amount: Number(row.amount),
  date: row.expense_date,
  method: row.method,
  notes: row.notes ?? "",
  recurring_rule_id: row.recurring_rule_id ?? null,
  recurring_due_month: row.recurring_due_month ?? null,
  payment_status: row.payment_status ?? "paid",
  payment_due_date: row.payment_due_date ?? null,
  paid_at: row.paid_at ?? null,
});
const newRequestId = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "";
const blankMonthlyForm = (month: string) => ({ title: "", category: "Rent", amount: "", defaultMethod: "Bank Transfer", dueDay: "1", startMonth: month, notes: "" });

type InitialExpenseAction = "fixed-monthly" | "record-payment";

export default function SharedExpensesWorkspace({ initialAction }: { initialAction?: InitialExpenseAction } = {}) {
  const scope = useWorkspaceScope();
  const isMonthlyExpensesPage = initialAction === "fixed-monthly";
  const isRecordPaymentPage = initialAction === "record-payment";
  const instituteId = scope.selection?.instituteId ?? "";
  const branchId = scope.selection?.branchId ?? "";
  const institute = scope.institutes.find((item) => item.id === instituteId);
  const canUseFinance = !!institute && ["owner", "administrator", "accountant"].includes(institute.role);
  const [month, setMonth] = useState("");
  const [rows, setRows] = useState<Expense[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [monthTotal, setMonthTotal] = useState<number | null>(null);
  const [summaryCount, setSummaryCount] = useState<number | null>(null);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [form, setForm] = useState<ExpenseForm>({ title: "", category: "Rent", amount: 0, date: "", method: "", notes: "", paymentStatus: "unpaid", paymentDueDate: "", paidAt: "" });
  const [monthlyRules, setMonthlyRules] = useState<RecurringRule[]>([]);
  const [monthlyOccurrences, setMonthlyOccurrences] = useState<RecurringOccurrence[]>([]);
  const [unpaidExpenses, setUnpaidExpenses] = useState<Expense[]>([]);
  const [businessToday, setBusinessToday] = useState("");
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [showMonthlyForm, setShowMonthlyForm] = useState(false);
  const [monthlyForm, setMonthlyForm] = useState(blankMonthlyForm(""));
  const [selectedOccurrence, setSelectedOccurrence] = useState<RecurringOccurrence | null>(null);
  const [selectedUnpaidExpense, setSelectedUnpaidExpense] = useState<Expense | null>(null);
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [confirmedPayment, setConfirmedPayment] = useState(false);
  const [monthlySaving, setMonthlySaving] = useState(false);
  const createRequestId = useRef("");
  const monthlyRequestId = useRef("");
  const paymentRequestId = useRef("");
  const handledInitialAction = useRef<InitialExpenseAction | undefined>(undefined);
  const scopePending = scope.loading || !!scope.blocker || (!!scope.selection && (scope.selection.instituteId !== instituteId || scope.selection.branchId !== branchId));
  const scopeKey = `${instituteId}::${branchId}::${month}`;
  const visibleScopeReady = loadedScopeKey === scopeKey;

  // Default the summary month and form date on the client from the institute's
  // own time zone. Kept out of render so no `new Date()` runs during prerender.
  useEffect(() => {
    void Promise.resolve().then(() => {
      const today = dateInTimeZone(new Date(), institute?.timeZone);
      setMonth((current) => current || today.slice(0, 7));
      setForm((current) => current.date ? current : { ...current, date: today });
      setForm((current) => ({ ...current, paymentDueDate: current.paymentDueDate || today, paidAt: current.paidAt || today }));
      setMonthlyForm((current) => current.startMonth ? current : { ...current, startMonth: today.slice(0, 7) });
      setPaymentDate((current) => current || today);
    });
  }, [institute?.timeZone]);

  useEffect(() => {
    if (!initialAction || handledInitialAction.current === initialAction || scope.loading || scopePending || !canUseFinance) return;
    const timer = window.setTimeout(() => {
      if (handledInitialAction.current === initialAction) return;
      handledInitialAction.current = initialAction;
      setShowForm(false);
      setShowMonthlyForm(false);
      setSelectedOccurrence(null);
      setSelectedUnpaidExpense(null);
      if (initialAction === "record-payment") {
        document.getElementById("expense-unpaid-records")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canUseFinance, initialAction, institute?.timeZone, scope.loading, scopePending]);

  useEffect(() => {
    if (scopePending || !instituteId || !canUseFinance || (institute?.accessScope === "branches" && !branchId)) {
      void Promise.resolve().then(() => {
        setMonthlyRules([]);
        setMonthlyOccurrences([]);
        setUnpaidExpenses([]);
        setBusinessToday("");
      });
      return;
    }
    let active = true;
    void Promise.resolve().then(() => { if (active) setMonthlyLoading(true); });
    const params = new URLSearchParams({ instituteId });
    if (branchId) params.set("branchId", branchId);
    void fetch(`/api/expenses/recurring?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as RecurringResponse;
        if (!response.ok) throw new Error(result.error || "Could not load monthly expenses.");
        return result;
      })
      .then((result) => {
        if (!active) return;
        setMonthlyRules(result.rules ?? []);
        setMonthlyOccurrences(result.occurrences ?? []);
        setUnpaidExpenses((result.unpaidExpenses ?? []).map(mapExpense));
        setBusinessToday(result.today ?? "");
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load monthly expenses."); })
      .finally(() => { if (active) setMonthlyLoading(false); });
    return () => { active = false; };
  }, [branchId, canUseFinance, institute?.accessScope, instituteId, retryVersion, scopePending]);

  useEffect(() => {
    if (scopePending || !instituteId || !canUseFinance || !month || (institute?.accessScope === "branches" && !branchId)) {
      void Promise.resolve().then(() => {
        setRows([]);
        setTotalCount(0);
        setOffset(0);
        setMonthTotal(null);
        setSummaryCount(null);
        setLoadedScopeKey("");
      });
      return;
    }
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setLoading(true);
      setError("");
      setLoadedScopeKey("");
    });
    const params = new URLSearchParams({ instituteId, month, offset: "0" });
    if (branchId) params.set("branchId", branchId);
    void fetch(`/api/expenses?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as ExpenseListResponse;
        if (!response.ok) throw new Error(result.error || "Could not load shared expenses.");
        return result;
      })
      .then((result) => {
        if (!active) return;
        const expenses = (result.expenses ?? []).map(mapExpense);
        setRows(expenses);
        setTotalCount(result.totalCount ?? expenses.length);
        setOffset(expenses.length);
        setHasMore(result.hasMore === true);
        setMonthTotal(result.summary?.monthTotal ?? null);
        setSummaryCount(result.summary?.expenseCount ?? null);
        setLoadedScopeKey(scopeKey);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load shared expenses.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [branchId, canUseFinance, institute?.accessScope, instituteId, month, retryVersion, scopeKey, scopePending]);

  const visibleRows = useMemo(() => (visibleScopeReady ? rows : []).filter((row) => `${row.title} ${row.category} ${row.notes}`.toLowerCase().includes(query.trim().toLowerCase())), [query, rows, visibleScopeReady]);
  const pendingOccurrences = monthlyOccurrences.filter((item) => item.status !== "paid");
  const overdueCount = pendingOccurrences.filter((item) => item.status === "overdue").length
    + unpaidExpenses.filter((item) => !!item.payment_due_date && !!businessToday && item.payment_due_date < businessToday).length;
  const dueTodayCount = pendingOccurrences.filter((item) => item.status === "due_today").length
    + unpaidExpenses.filter((item) => item.payment_due_date === businessToday).length;
  const outstandingExpenseAmount = pendingOccurrences.reduce((sum, item) => sum + item.amount, 0)
    + unpaidExpenses.reduce((sum, item) => sum + item.amount, 0);

  async function loadMore() {
    if (!instituteId || loading) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ instituteId, month, offset: String(offset) });
      if (branchId) params.set("branchId", branchId);
      const response = await fetch(`/api/expenses?${params}`, { cache: "no-store" });
      const result = await response.json() as ExpenseListResponse;
      if (!response.ok) throw new Error(result.error || "Could not load more expenses.");
      const more = (result.expenses ?? []).map(mapExpense);
      setRows((current) => [...current, ...more]);
      setOffset((current) => current + more.length);
      setHasMore(result.hasMore === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more expenses.");
    } finally {
      setLoading(false);
    }
  }

  function beginCreate() {
    setEditingId("");
    const today = dateInTimeZone(new Date(), institute?.timeZone);
    setForm({ title: "", category: "Rent", amount: 0, date: today, method: "Bank Transfer", notes: "", paymentStatus: "unpaid", paymentDueDate: today, paidAt: today });
    createRequestId.current = "";
    setError("");
    setShowForm(true);
  }

  function beginEdit(row: Expense) {
    setEditingId(row.id);
    setForm({ title: row.title, category: row.category, amount: row.amount, date: row.date, method: row.method ?? "Bank Transfer", notes: row.notes, paymentStatus: row.payment_status, paymentDueDate: row.payment_due_date ?? "", paidAt: row.paid_at ?? row.date });
    setError("");
    setShowForm(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!instituteId || !canUseFinance || scopePending) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (!editingId && !createRequestId.current) {
        createRequestId.current = newRequestId();
        if (!createRequestId.current) throw new Error("Secure retry keys are unavailable in this browser.");
      }
      const response = await fetch("/api/expenses", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instituteId,
          branchId: branchId || null,
          ...(editingId ? { expenseId: editingId } : { requestId: createRequestId.current }),
          title: form.title,
          category: form.category,
          amount: form.amount,
          expenseDate: form.date,
          paymentStatus: form.paymentStatus,
          paymentDueDate: form.paymentDueDate || null,
          paidAt: form.paymentStatus === "paid" ? form.paidAt : null,
          method: form.paymentStatus === "paid" ? form.method : null,
          notes: form.notes,
        }),
      });
      const result = await response.json() as { expense?: ApiExpense; error?: string };
      if (!response.ok || !result.expense) throw new Error(result.error || "Could not save the expense.");
      const saved = mapExpense(result.expense);
      setRows((current) => editingId ? current.map((row) => row.id === saved.id ? saved : row) : [saved, ...current]);
      setShowForm(false);
      setEditingId("");
      createRequestId.current = "";
      setMonthTotal(null);
      setNotice(editingId ? "Expense updated and audited." : "Expense saved to the institute database.");
      setRetryVersion((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the expense.");
    } finally {
      setSaving(false);
    }
  }

  function changeMonthlyForm(patch: Partial<typeof monthlyForm>) {
    monthlyRequestId.current = "";
    setMonthlyForm((current) => ({ ...current, ...patch }));
  }

  function beginMonthlyCreate() {
    const today = dateInTimeZone(new Date(), institute?.timeZone);
    monthlyRequestId.current = "";
    setMonthlyForm(blankMonthlyForm(today.slice(0, 7)));
    setError("");
    setShowMonthlyForm(true);
  }

  async function submitMonthlyRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!instituteId || !canUseFinance || scopePending) return;
    setMonthlySaving(true);
    setError("");
    setNotice("");
    try {
      if (!monthlyRequestId.current) {
        monthlyRequestId.current = newRequestId();
        if (!monthlyRequestId.current) throw new Error("Secure retry keys are unavailable in this browser.");
      }
      const response = await fetch("/api/expenses/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_rule", instituteId, branchId: branchId || null,
          requestId: monthlyRequestId.current, title: monthlyForm.title,
          category: monthlyForm.category, amount: monthlyForm.amount,
          defaultMethod: monthlyForm.defaultMethod, dueDay: Number(monthlyForm.dueDay),
          startMonth: monthlyForm.startMonth, notes: monthlyForm.notes,
        }),
      });
      const result = await response.json() as { ruleId?: string; error?: string };
      if (!response.ok || !result.ruleId) throw new Error(result.error || "Could not save the monthly reminder.");
      setShowMonthlyForm(false);
      monthlyRequestId.current = "";
      setNotice("Monthly reminder saved. It will appear here when due; it is not counted as an expense until payment is recorded.");
      setRetryVersion((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the monthly reminder.");
    } finally {
      setMonthlySaving(false);
    }
  }

  function beginRecordMonthlyPayment(occurrence: RecurringOccurrence) {
    const today = dateInTimeZone(new Date(), institute?.timeZone);
    paymentRequestId.current = "";
    setSelectedOccurrence(occurrence);
    setPaymentDate(today);
    setPaymentMethod(occurrence.defaultMethod);
    setConfirmedPayment(false);
    setError("");
  }

  async function recordMonthlyPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOccurrence || !confirmedPayment || !instituteId || scopePending) return;
    setMonthlySaving(true);
    setError("");
    setNotice("");
    try {
      if (!paymentRequestId.current) {
        paymentRequestId.current = newRequestId();
        if (!paymentRequestId.current) throw new Error("Secure retry keys are unavailable in this browser.");
      }
      const response = await fetch("/api/expenses/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record_payment", instituteId, ruleId: selectedOccurrence.ruleId,
          dueMonth: selectedOccurrence.dueMonth, paymentDate,
          method: paymentMethod, requestId: paymentRequestId.current,
        }),
      });
      const result = await response.json() as { expense?: ApiExpense; error?: string };
      if (!response.ok || !result.expense) throw new Error(result.error || "Could not record the monthly expense payment.");
      const saved = mapExpense(result.expense);
      setRows((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      setSelectedOccurrence(null);
      paymentRequestId.current = "";
      setNotice(`${saved.title} payment recorded in the shared expense ledger.`);
      setMonthTotal(null);
      setRetryVersion((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the monthly expense payment.");
    } finally {
      setMonthlySaving(false);
    }
  }

  function beginRecordUnpaidExpensePayment(expense: Expense) {
    const today = dateInTimeZone(new Date(), institute?.timeZone);
    setSelectedUnpaidExpense(expense);
    setPaymentDate(today);
    setPaymentMethod("Bank Transfer");
    setConfirmedPayment(false);
    setError("");
  }

  async function recordUnpaidExpensePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUnpaidExpense || !confirmedPayment || !instituteId || scopePending) return;
    setMonthlySaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/expenses/record-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instituteId, expenseId: selectedUnpaidExpense.id, paidAt: paymentDate, method: paymentMethod }),
      });
      const result = await response.json() as { expense?: ApiExpense; error?: string };
      if (!response.ok || !result.expense) throw new Error(result.error || "Could not record the expense payment.");
      const saved = mapExpense(result.expense);
      setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
      setSelectedUnpaidExpense(null);
      setNotice(`${saved.title} marked paid and added to expense payment history.`);
      setMonthTotal(null);
      setRetryVersion((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the expense payment.");
    } finally {
      setMonthlySaving(false);
    }
  }

  async function pauseMonthlyRule(rule: RecurringRule) {
    if (!window.confirm(`Pause the monthly reminder for “${rule.title}”? Existing expenses and due history will remain.`)) return;
    setError("");
    try {
      const response = await fetch("/api/expenses/recurring", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instituteId, ruleId: rule.id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not pause this monthly reminder.");
      setNotice("Monthly reminder paused. Previously due items remain available for payment recording.");
      setRetryVersion((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not pause this monthly reminder.");
    }
  }

  async function voidExpense(row: Expense) {
    const reason = window.prompt(`Reason for voiding “${row.title}” (required):`)?.trim();
    if (!reason) return;
    if (reason.length < 3 || reason.length > 500) {
      setError("Enter a reason between 3 and 500 characters.");
      return;
    }
    setError("");
    try {
      const response = await fetch("/api/expenses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instituteId, expenseId: row.id, reason }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not void the expense.");
      setRows((current) => current.filter((item) => item.id !== row.id));
      setTotalCount((current) => Math.max(0, current - 1));
      setMonthTotal(null);
      setNotice("Expense voided. The reason is retained in the audit history.");
      setRetryVersion((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not void the expense.");
    }
  }

  return (
    <WorkspaceLayout>
      <main className="min-h-screen bg-[#f3f7f5] px-3 py-4 sm:px-5 lg:px-6">
        <div className="mx-auto max-w-7xl space-y-4 sm:space-y-5">
          <header className="relative isolate overflow-hidden rounded-[18px] bg-gradient-to-br from-[#103628] via-[#08734f] to-[#21a477] p-4 text-white shadow-[0_20px_48px_-32px_rgba(8,115,79,0.55)] sm:rounded-3xl sm:p-5 lg:p-6">
            <div className="pointer-events-none absolute -right-20 -top-36 size-64 rounded-full border border-white/15 bg-white/[0.04]" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-36 right-1/3 size-56 rounded-full border border-white/10" aria-hidden="true" />
            <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-50"><span className="size-2 rounded-full bg-lime-300" aria-hidden="true" /> BIZBOOK · FINANCE</p>
                <h1 className="mt-1.5 text-xl font-extrabold tracking-tight sm:text-2xl">{isRecordPaymentPage ? "Due dates & payments" : isMonthlyExpensesPage ? "Fixed expense setup" : "Expense history"}</h1>
                <p className="mt-1.5 max-w-2xl text-xs leading-5 text-emerald-50/90 sm:text-sm">{isRecordPaymentPage ? "See what is due, when it is due, and what has been paid. Record a transaction only after payment is complete." : isMonthlyExpensesPage ? "Create each recurring obligation once. Monthly due items appear on the payment page; they enter expense totals after payment is recorded." : "Search and review recorded expense transactions for the selected month."}</p>
              </div>
              <div className="relative z-10 flex w-full flex-col gap-2 min-[430px]:flex-row sm:w-auto sm:shrink-0 sm:flex-wrap sm:justify-end">
                {isMonthlyExpensesPage && <button type="button" onClick={beginMonthlyCreate} disabled={!canUseFinance || scopePending} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-extrabold text-emerald-900 shadow-sm transition hover:bg-emerald-50 disabled:opacity-50 min-[430px]:w-auto"><Plus size={15} /> Add fixed expense</button>}
                {isRecordPaymentPage && <>
                  <button type="button" onClick={() => document.getElementById("expense-unpaid-records")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/35 bg-white/10 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/20 min-[430px]:w-auto">View due items</button>
                  <button type="button" onClick={beginCreate} disabled={!canUseFinance || scopePending} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-extrabold text-emerald-900 shadow-sm transition hover:bg-emerald-50 disabled:opacity-50 min-[430px]:w-auto"><Plus size={14} /> Record expense</button>
                  <Link href="/expenses" className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-white/35 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/20 min-[430px]:w-auto">History <ArrowUpRight size={13} /></Link>
                </>}
                {initialAction === undefined && <>
                  <button type="button" onClick={beginMonthlyCreate} disabled={!canUseFinance || scopePending} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/35 bg-white/10 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/20 min-[430px]:w-auto"><CalendarClock size={14} /> Fixed expenses</button>
                  <button type="button" onClick={beginCreate} disabled={!canUseFinance || scopePending} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-extrabold text-emerald-900 shadow-sm transition hover:bg-emerald-50 disabled:opacity-50 min-[430px]:w-auto"><Plus size={14} /> Add expense</button>
                </>}
              </div>
            </div>
          </header>
          {(isMonthlyExpensesPage || isRecordPaymentPage) && <nav aria-label="Expense tasks" className="flex flex-wrap gap-2 rounded-2xl border border-emerald-100 bg-white p-2 shadow-sm">
            <Link href="/expenses/fixed-monthly" aria-current={isMonthlyExpensesPage ? "page" : undefined} className={`inline-flex min-h-10 items-center rounded-xl px-3.5 py-2 text-xs font-bold transition sm:text-sm ${isMonthlyExpensesPage ? "bg-emerald-800 text-white shadow-sm" : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-900"}`}><CalendarClock size={15} className="mr-2" /> Fixed expense setup</Link>
            <Link href="/expenses/record-payment" aria-current={isRecordPaymentPage ? "page" : undefined} className={`inline-flex min-h-10 items-center rounded-xl px-3.5 py-2 text-xs font-bold transition sm:text-sm ${isRecordPaymentPage ? "bg-emerald-800 text-white shadow-sm" : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-900"}`}><CircleDollarSign size={15} className="mr-2" /> Due dates & payments</Link>
          </nav>}
          {!isMonthlyExpensesPage && !isRecordPaymentPage && <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
            <div className="relative min-w-0 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-white to-blue-50/80 p-3 shadow-[0_4px_14px_rgba(30,64,175,0.06)] sm:p-4"><div className="flex items-start justify-between gap-1"><p className="min-w-0 text-[11px] font-semibold leading-tight text-slate-500 sm:text-xs">Active records</p><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-100/80 text-blue-700"><ReceiptText size={14} /></span></div><p className="mt-2 truncate text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">{totalCount}</p></div>
            <div className="relative min-w-0 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/80 p-3 shadow-[0_4px_14px_rgba(30,64,175,0.06)] sm:p-4"><div className="flex items-start justify-between gap-1"><p className="min-w-0 text-[11px] font-semibold leading-tight text-slate-500 sm:text-xs">Paid this month</p><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-indigo-100/80 text-indigo-700"><CalendarClock size={14} /></span></div><p className="mt-2 truncate text-lg font-extrabold tracking-tight text-slate-900 sm:text-2xl">{monthTotal === null ? "—" : money(monthTotal)}</p></div>
            <div className="col-span-2 min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_4px_14px_rgba(15,23,42,0.04)] sm:col-span-1 sm:p-4"><label className="text-xs font-semibold text-slate-500" htmlFor="expense-month">Summary month</label><input id="expense-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={`${inputClass} mt-1`} /></div>
          </section>}
          {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
          {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><span>{error}</span><button type="button" onClick={() => { setRetryVersion((current) => current + 1); setError(""); }} className={secondaryClass}><RefreshCw size={14} /> Retry</button></div>}
          {!institute && !scope.loading && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Sign in and join or create an institute to manage expenses.</p>}
          {institute && !canUseFinance && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Your institute role can view other areas but cannot manage business expenses.</p>}
          {canUseFinance && isRecordPaymentPage && <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3" aria-label="Expense payment summary">
            <div className="rounded-2xl border border-rose-100 bg-gradient-to-br from-white to-rose-50/70 p-3 shadow-sm sm:p-4"><p className="text-[10px] font-semibold text-slate-500 sm:text-xs">Overdue</p><p className="mt-1 text-lg font-extrabold tabular-nums text-rose-700 sm:text-2xl">{overdueCount}</p></div>
            <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-white to-amber-50/70 p-3 shadow-sm sm:p-4"><p className="text-[10px] font-semibold text-slate-500 sm:text-xs">Due today</p><p className="mt-1 text-lg font-extrabold tabular-nums text-amber-700 sm:text-2xl">{dueTodayCount}</p></div>
            <div className="col-span-2 rounded-2xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50/70 p-3 shadow-sm sm:col-span-1 sm:p-4"><p className="text-[10px] font-semibold text-slate-500 sm:text-xs">Unpaid total</p><p className="mt-1 truncate text-base font-extrabold tabular-nums text-emerald-800 sm:text-xl">{money(outstandingExpenseAmount)}</p></div>
          </section>}
          {canUseFinance && (isMonthlyExpensesPage || isRecordPaymentPage) && (
            <section id="expense-unpaid-records" className="scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
                <div>
                  <h2 className="font-bold text-slate-900">{isMonthlyExpensesPage ? "Your fixed expense schedules" : "Due dates & payment status"}</h2>
                  <p className="text-xs text-slate-500">{isMonthlyExpensesPage ? "Set each recurring expense once. This page manages schedules only; payment records stay on Due Dates & Payments." : "Fixed monthly bills and unpaid expenses appear together. Record payment after the money has been paid."}</p>
                </div>
                {isMonthlyExpensesPage
                  ? <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">{monthlyRules.length} schedule{monthlyRules.length === 1 ? "" : "s"}</span>
                  : <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${overdueCount ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}><span className={`h-2 w-2 rounded-full ${overdueCount ? "bg-rose-600" : "bg-emerald-600"}`} />{overdueCount} overdue</span>}
              </div>
              {monthlyLoading ? <p className="p-5 text-sm text-slate-500">Loading expense schedules...</p> : isMonthlyExpensesPage ? (
                monthlyRules.length > 0 ? <div className="divide-y divide-slate-100">
                  {monthlyRules.map((rule) => (
                    <article key={rule.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><CalendarClock size={17} /></span>
                        <div className="min-w-0"><h3 className="truncate text-sm font-bold text-slate-900">{rule.title}</h3><p className="mt-1 text-xs text-slate-500">{rule.category} · Due monthly on day {rule.due_day} · Starts {rule.start_month}</p>{rule.notes && <p className="mt-1 truncate text-[11px] text-slate-500">{rule.notes}</p>}</div>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end"><div className="text-right"><p className="text-sm font-extrabold tabular-nums text-slate-900">{money(Number(rule.amount))}</p><p className="text-[10px] text-slate-500">{rule.default_method}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${rule.ends_on ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{rule.ends_on ? "Paused" : "Active"}</span>{!rule.ends_on && <button type="button" onClick={() => void pauseMonthlyRule(rule)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">Pause</button>}</div>
                    </article>
                  ))}
                </div> : <div className="p-6 text-center sm:p-8"><span className="mx-auto grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><CalendarClock size={19} /></span><p className="mt-3 text-sm font-bold text-slate-900">No fixed expense schedules yet</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">Add rent, utilities, or other repeating costs. BizBook will create due reminders on the payment page.</p><button type="button" onClick={beginMonthlyCreate} className={`${buttonClass} mt-4`}><Plus size={15} /> Add fixed expense</button></div>
              ) : (
                <>
                  {pendingOccurrences.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                      {pendingOccurrences.map((item) => (
                        <article key={`${item.ruleId}:${item.dueMonth}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-start gap-3">
                            <span className={`mt-1 rounded-xl p-2 ${item.status === "overdue" ? "bg-rose-50 text-rose-600" : item.status === "due_today" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                              {item.status === "overdue" ? <AlertCircle size={18} /> : <CalendarClock size={18} />}
                            </span>
                            <div>
                              <h3 className="font-semibold text-slate-900">{item.title} <span className="font-normal text-slate-500">{item.dueMonth}</span></h3>
                              <p className="mt-1 text-xs text-slate-500">{item.category} · Due {item.dueDate} · {item.defaultMethod}</p>
                              <p className={`mt-1 text-xs font-semibold ${item.status === "overdue" ? "text-rose-700" : item.status === "due_today" ? "text-amber-700" : "text-emerald-700"}`}>{item.status === "overdue" ? "Overdue" : item.status === "due_today" ? "Due today" : "Upcoming"}</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-3 sm:justify-end"><strong className="text-sm font-extrabold tabular-nums text-slate-900">{money(item.amount)}</strong><button type="button" onClick={() => beginRecordMonthlyPayment(item)} className={buttonClass}><CheckCircle2 size={15} /> Record payment</button></div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="p-5 text-sm text-slate-500">No fixed monthly payments are currently due.</p>
                  )}

                  <div className="border-t border-slate-100">
                      <div className="px-4 pt-4 sm:px-5">
                        <h3 className="font-bold text-slate-900">Other unpaid expenses</h3>
                        <p className="text-xs text-slate-500">One-time expenses saved as unpaid, with their due dates and amounts.</p>
                      </div>
                      {unpaidExpenses.length > 0 ? (
                        <div className="divide-y divide-slate-100">
                          {unpaidExpenses.map((item) => {
                            const overdue = !!item.payment_due_date && !!businessToday && item.payment_due_date < businessToday;
                            const dueToday = item.payment_due_date === businessToday;
                            return (
                              <article key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <h4 className="font-semibold text-slate-900">{item.title} <span className="font-normal text-slate-500">{money(item.amount)}</span></h4>
                                  <p className="mt-1 text-xs text-slate-500">{item.category} · Added {item.date} · Due {item.payment_due_date ?? "No due date"}</p>
                                  <p className={`mt-1 text-xs font-semibold ${overdue ? "text-rose-700" : dueToday ? "text-amber-700" : "text-slate-500"}`}>{overdue ? "Overdue" : dueToday ? "Due today" : "Unpaid"}</p>
                                </div>
                                <button type="button" onClick={() => beginRecordUnpaidExpensePayment(item)} className={buttonClass}><CheckCircle2 size={16} /> Record payment</button>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="p-4 text-sm text-slate-500">No one-time unpaid expenses. Use “Record expense” above to add one.</p>
                      )}
                  </div>
                </>
              )}
            </section>
          )}
          {!isMonthlyExpensesPage && !isRecordPaymentPage && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-slate-900">Expense ledger</h2><p className="text-xs text-slate-500">{summaryCount === null ? "Summary unavailable" : `${summaryCount} paid records for ${month}`}</p></div><div className="flex gap-2"><div className="relative"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search expenses" className={`${inputClass} pl-9`} /></div><button type="button" onClick={() => setRetryVersion((current) => current + 1)} disabled={loading} className={secondaryClass}><RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh</button></div></div>
            {loading || !visibleScopeReady ? <p className="p-6 text-sm text-slate-500">Loading expenses…</p> : visibleRows.length === 0 ? <p className="p-6 text-sm text-slate-500">No expense records match this institute, branch, month, and search.</p> : <div className="divide-y divide-slate-100">{visibleRows.map((row) => <article key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h3 className="font-semibold text-slate-900">{row.title} <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${row.payment_status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{row.payment_status}</span></h3><p className="mt-1 text-xs text-slate-500">{row.category} · Expense date {row.date}{row.payment_status === "paid" ? ` · Paid ${row.paid_at ?? ""} by ${row.method ?? ""}` : ` · Due ${row.payment_due_date ?? "date not set"}`}{row.recurring_due_month ? ` · Monthly ${row.recurring_due_month.slice(0, 7)}` : ""}{row.notes ? ` · ${row.notes}` : ""}</p></div><div className="flex items-center justify-between gap-3 sm:justify-end"><strong className="text-lg text-slate-900">{money(row.amount)}</strong>{row.payment_status === "unpaid" && <button type="button" onClick={() => beginRecordUnpaidExpensePayment(row)} className={secondaryClass}>Record payment</button>}{!row.recurring_rule_id && row.payment_status === "paid" && <button type="button" onClick={() => beginEdit(row)} className={secondaryClass}>Edit</button>}<button type="button" onClick={() => void voidExpense(row)} className="rounded-xl border border-rose-200 px-3 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50">Void</button></div></article>)}</div>}
            {hasMore && <button type="button" onClick={() => void loadMore()} disabled={loading} className="m-4 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">{loading ? "Loading…" : `Load more (${offset} of ${totalCount})`}</button>}
          </section>}
        </div>
      </main>
      {showMonthlyForm && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-3"><section role="dialog" aria-modal="true" aria-labelledby="monthly-expense-title" className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><h2 id="monthly-expense-title" className="text-lg font-bold text-slate-900">Add fixed monthly expense</h2><p className="mt-1 text-sm text-slate-500">Creates a reminder only. It enters expense totals after payment is recorded.</p></div><button type="button" onClick={() => setShowMonthlyForm(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={18} /></button></div>
        <form onSubmit={submitMonthlyRule} className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-slate-600">Expense name<input required maxLength={120} value={monthlyForm.title} onChange={(event) => changeMonthlyForm({ title: event.target.value })} className={`${inputClass} mt-1`} placeholder="Rent, internet, software…" /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold text-slate-600">Category<select value={monthlyForm.category} onChange={(event) => changeMonthlyForm({ category: event.target.value })} className={`${inputClass} mt-1`}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label className="block text-xs font-semibold text-slate-600">Fixed amount (₹)<input required type="number" min="0.01" step="0.01" value={monthlyForm.amount} onChange={(event) => changeMonthlyForm({ amount: event.target.value })} className={`${inputClass} mt-1`} /></label></div>
          <div className="grid gap-3 sm:grid-cols-3"><label className="block text-xs font-semibold text-slate-600">Due day<input required type="number" min="1" max="28" step="1" value={monthlyForm.dueDay} onChange={(event) => changeMonthlyForm({ dueDay: event.target.value })} className={`${inputClass} mt-1`} /><span className="mt-1 block font-normal text-slate-500">Choose day 1–28</span></label><label className="block text-xs font-semibold text-slate-600">Start month<input required type="month" value={monthlyForm.startMonth} onChange={(event) => changeMonthlyForm({ startMonth: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="block text-xs font-semibold text-slate-600">Usual payment method<select value={monthlyForm.defaultMethod} onChange={(event) => changeMonthlyForm({ defaultMethod: event.target.value })} className={`${inputClass} mt-1`}>{METHODS.map((method) => <option key={method}>{method}</option>)}</select></label></div>
          <label className="block text-xs font-semibold text-slate-600">Notes<textarea maxLength={500} rows={2} value={monthlyForm.notes} onChange={(event) => changeMonthlyForm({ notes: event.target.value })} className={`${inputClass} mt-1`} /></label>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowMonthlyForm(false)} className={secondaryClass}>Cancel</button><button type="submit" disabled={monthlySaving} className={buttonClass}>{monthlySaving ? "Saving…" : "Save monthly reminder"}</button></div>
        </form>
      </section></div>}
      {selectedOccurrence && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-3"><section role="dialog" aria-modal="true" aria-labelledby="record-monthly-payment-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><h2 id="record-monthly-payment-title" className="text-lg font-bold text-slate-900">Record monthly expense payment</h2><p className="mt-1 text-sm text-slate-500">{selectedOccurrence.title} · {selectedOccurrence.dueMonth}</p></div><button type="button" onClick={() => setSelectedOccurrence(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={18} /></button></div>
        <div className="mt-4 rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 p-4"><p className="text-xs font-semibold text-emerald-800">Fixed scheduled amount</p><p className="mt-1 text-2xl font-extrabold text-slate-900">{money(selectedOccurrence.amount)}</p><p className="mt-1 text-xs text-slate-600">The amount comes from the saved schedule and is added once to the shared expense ledger.</p></div>
        <form onSubmit={recordMonthlyPayment} className="mt-4 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold text-slate-600">Date paid<input required type="date" value={paymentDate} onChange={(event) => { paymentRequestId.current = ""; setConfirmedPayment(false); setPaymentDate(event.target.value); }} className={`${inputClass} mt-1`} /></label><label className="block text-xs font-semibold text-slate-600">Paid by<select value={paymentMethod} onChange={(event) => { paymentRequestId.current = ""; setConfirmedPayment(false); setPaymentMethod(event.target.value); }} className={`${inputClass} mt-1`}>{METHODS.map((method) => <option key={method}>{method}</option>)}</select></label></div>
          <label className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-950"><input required type="checkbox" checked={confirmedPayment} onChange={(event) => setConfirmedPayment(event.target.checked)} className="mt-0.5 accent-emerald-700" /><span>I confirm this expense has already been paid. This only records it; it does not transfer money.</span></label>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setSelectedOccurrence(null)} className={secondaryClass}>Cancel</button><button type="submit" disabled={monthlySaving || !confirmedPayment} className={buttonClass}>{monthlySaving ? "Recording…" : "Confirm payment recorded"}</button></div>
        </form>
      </section></div>}
      {selectedUnpaidExpense && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-3"><section role="dialog" aria-modal="true" aria-labelledby="record-unpaid-expense-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><h2 id="record-unpaid-expense-title" className="text-lg font-bold text-slate-900">Record expense payment</h2><p className="mt-1 text-sm text-slate-500">{selectedUnpaidExpense.title}</p></div><button type="button" onClick={() => setSelectedUnpaidExpense(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={18} /></button></div>
        <div className="mt-4 rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 p-4"><p className="text-xs font-semibold text-emerald-800">Full expense amount</p><p className="mt-1 text-2xl font-extrabold text-slate-900">{money(selectedUnpaidExpense.amount)}</p><p className="mt-1 text-xs text-slate-600">This records full payment against the expense. Partial payments are not supported in this workflow.</p></div>
        <form onSubmit={recordUnpaidExpensePayment} className="mt-4 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold text-slate-600">Date paid<input required type="date" value={paymentDate} onChange={(event) => { setConfirmedPayment(false); setPaymentDate(event.target.value); }} className={`${inputClass} mt-1`} /></label><label className="block text-xs font-semibold text-slate-600">Paid by<select value={paymentMethod} onChange={(event) => { setConfirmedPayment(false); setPaymentMethod(event.target.value); }} className={`${inputClass} mt-1`}>{METHODS.map((method) => <option key={method}>{method}</option>)}</select></label></div>
          <label className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-950"><input required type="checkbox" checked={confirmedPayment} onChange={(event) => setConfirmedPayment(event.target.checked)} className="mt-0.5 accent-emerald-700" /><span>I confirm the expense was already paid. This only records payment; it does not transfer money.</span></label>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setSelectedUnpaidExpense(null)} className={secondaryClass}>Cancel</button><button type="submit" disabled={monthlySaving || !confirmedPayment} className={buttonClass}>{monthlySaving ? "Recording…" : "Confirm payment recorded"}</button></div>
        </form>
      </section></div>}
      {showForm && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-3"><section role="dialog" aria-modal="true" aria-labelledby="expense-form-title" className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><h2 id="expense-form-title" className="text-lg font-bold text-slate-900">{editingId ? "Edit expense" : "Record expense"}</h2><p className="mt-1 text-sm text-slate-500">Save the expense when it is incurred. Record its payment separately after the money is paid.</p></div><button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={18} /></button></div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-slate-600">Title<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={`${inputClass} mt-1`} /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold text-slate-600">Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className={`${inputClass} mt-1`}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label className="block text-xs font-semibold text-slate-600">Amount (₹)<input required type="number" min="0.01" step="0.01" value={form.amount || ""} onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label></div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold text-slate-600">Expense date<input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="block text-xs font-semibold text-slate-600">Payment status<select disabled={!!editingId} value={form.paymentStatus} onChange={(event) => { const paymentStatus = event.target.value as "paid" | "unpaid"; setForm({ ...form, paymentStatus, method: paymentStatus === "paid" ? "Bank Transfer" : "", paidAt: paymentStatus === "paid" ? dateInTimeZone(new Date(), institute?.timeZone) : "" }); }} className={`${inputClass} mt-1`}><option value="unpaid">Unpaid</option><option value="paid">Already paid</option></select></label></div>
          {form.paymentStatus === "unpaid" ? <label className="block text-xs font-semibold text-slate-600">Payment due date<input required type="date" value={form.paymentDueDate} onChange={(event) => setForm({ ...form, paymentDueDate: event.target.value })} className={`${inputClass} mt-1`} /></label> : <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold text-slate-600">Date paid<input required type="date" value={form.paidAt} onChange={(event) => setForm({ ...form, paidAt: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="block text-xs font-semibold text-slate-600">Paid by<select required value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })} className={`${inputClass} mt-1`}>{METHODS.map((method) => <option key={method}>{method}</option>)}</select></label></div>}
          <label className="block text-xs font-semibold text-slate-600">Notes<textarea maxLength={500} rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={`${inputClass} mt-1`} /></label>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowForm(false)} className={secondaryClass}>Cancel</button><button type="submit" disabled={saving} className={buttonClass}>{saving ? "Saving…" : editingId ? "Save changes" : "Record expense"}</button></div>
        </form>
      </section></div>}
    </WorkspaceLayout>
  );
}
