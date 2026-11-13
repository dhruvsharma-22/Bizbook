"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Banknote, Building2, CheckCircle2, Clock3, LoaderCircle, RefreshCw, Users } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAuthorizedTestProjectConfigured, loadWorkspaceBranches, loadWorkspaceInstitutes, type WorkspaceBranch, type WorkspaceInstitute } from "@/lib/supabase/workspace-scope";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { monthInTimeZone } from "@/lib/business-date";

type PayrollRow = {
  staffId: string;
  name: string;
  designation: string | null;
  branchId: string | null;
  monthlySalary: number;
  payableAmount: number;
  attendanceDeduction: number;
  unpaidDays: number;
  payment: null | { status: "Paid"; amount: number; paidAt: string; method: string | null; reference: string | null };
};

const METHODS = ["Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Other"] as const;
const fieldClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100";
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);

export default function SharedPayrollWorkspace() {
  const workspaceScope = useWorkspaceScope();
  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [instituteId, setInstituteId] = useState("");
  const [branches, setBranches] = useState<WorkspaceBranch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [month, setMonth] = useState("");
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<PayrollRow | null>(null);
  const [method, setMethod] = useState<(typeof METHODS)[number]>("Bank Transfer");
  const [reference, setReference] = useState("");
  const [confirmAlreadyPaid, setConfirmAlreadyPaid] = useState(false);

  const selectedInstitute = institutes.find((item) => item.id === instituteId);
  const scopePending = workspaceScope.loading || (!!workspaceScope.selection
    && institutes.some((item) => item.id === workspaceScope.selection?.instituteId)
    && (instituteId !== workspaceScope.selection.instituteId || branchId !== workspaceScope.selection.branchId));
  const canRead = !scopePending && !!selectedInstitute && (selectedInstitute.accessScope === "institute" || !!branchId);
  const visibleRows = useMemo(() => scopePending ? [] : rows, [rows, scopePending]);
  const filteredRows = useMemo(() => visibleRows.filter((row) => `${row.name} ${row.designation ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())), [visibleRows, search]);
  const unpaidRows = visibleRows.filter((row) => !row.payment);
  const unpaidTotalCents = unpaidRows.reduce((sum, row) => sum + Math.round(row.payableAmount * 100), 0);
  const paidTotalCents = visibleRows.reduce((sum, row) => sum + (row.payment ? Math.round(row.payment.amount * 100) : 0), 0);

  // Default the payroll month on the client using the institute's own time zone.
  // Kept out of render so no `new Date()` runs during prerendering.
  useEffect(() => {
    void Promise.resolve().then(() => {
      setMonth((current) => current || monthInTimeZone(new Date(), selectedInstitute?.timeZone));
    });
  }, [selectedInstitute?.timeZone]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const next = workspaceScope.selection;
      if (!next || !institutes.some((item) => item.id === next.instituteId)) return;
      setInstituteId(next.instituteId);
      setBranchId(next.branchId);
      setSelected(null);
    });
    return () => { active = false; };
  }, [institutes, workspaceScope.selection]);

  useEffect(() => {
    let active = true;
    async function loadInstitutes() {
      setLoading(true);
      setError("");
      try {
        if (!isAuthorizedTestProjectConfigured()) throw new Error("Shared payroll is restricted to the authorized test project.");
        const supabase = createSupabaseBrowserClient();
        const available = (await loadWorkspaceInstitutes(supabase)).filter((item) => ["owner", "administrator", "accountant"].includes(item.role));
        if (!active) return;
        setInstitutes(available);
        setInstituteId((current) => current && available.some((item) => item.id === current) ? current : available[0]?.id ?? "");
        if (!available.length) setError("No active owner, administrator, or accountant institute membership was found.");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Institute access could not be loaded.");
      } finally { if (active) setLoading(false); }
    }
    void loadInstitutes();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!instituteId) return () => { active = false; };
    const supabase = createSupabaseBrowserClient();
    void loadWorkspaceBranches(supabase, instituteId).then((available) => {
      if (!active) return;
      setBranches(available);
      const membership = institutes.find((item) => item.id === instituteId);
      if (membership?.accessScope === "branches" && available.length === 1) setBranchId(available[0].id);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Branch access could not be loaded.");
    });
    return () => { active = false; };
  }, [instituteId, institutes]);

  const loadPayroll = useCallback(async () => {
    if (!instituteId || !selectedInstitute || !canRead || !month) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ instituteId, month });
      if (branchId) params.set("branchId", branchId);
      const response = await fetch(`/api/payroll?${params}`, { cache: "no-store" });
      const body = await response.json() as { rows?: PayrollRow[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Shared payroll could not be loaded.");
      setRows(body.rows ?? []);
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : "Shared payroll could not be loaded.");
    } finally { setLoading(false); }
  }, [branchId, canRead, instituteId, month, selectedInstitute]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPayroll(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPayroll, retry]);

  async function recordPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !instituteId || !canRead) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instituteId, branchId: selected.branchId, staffId: selected.staffId, month, amount: selected.payableAmount.toFixed(2), method, reference }),
      });
      const body = await response.json() as { error?: string; recorded?: boolean; alreadyRecorded?: boolean };
      if (response.status === 409 && body.alreadyRecorded) {
        setNotice(body.error ?? "This salary month is already paid; no duplicate was created.");
        setSelected(null);
        await loadPayroll();
        return;
      }
      if (!response.ok || body.recorded !== true) throw new Error(body.error ?? "Salary payment was not confirmed by the database.");
      setNotice("Salary payment was recorded in the selected institute database.");
      setSelected(null);
      setReference("");
      await loadPayroll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Salary payment could not be recorded.");
    } finally { setSaving(false); }
  }

  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#5B21B6]"><Building2 size={14} /> Shared database payroll</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">Institute salary ledger</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Read from the selected institute’s staff, attendance, and salary records. Saving uses the database salary transaction and does not write to browser storage.</p>
      </div>
      <button type="button" onClick={() => setRetry((value) => value + 1)} disabled={loading || !canRead} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"><RefreshCw size={15} /> Refresh</button>
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      {institutes.length > 1 && <label className="text-sm font-medium text-slate-700">Institute
        <select className={fieldClass} value={instituteId} onChange={(event) => { const next = event.target.value; setInstituteId(next); setBranches([]); setBranchId(""); setRows([]); setError(""); void workspaceScope.selectInstitute(next); }}>
          <option value="">Choose an institute</option>
          {institutes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      {selectedInstitute?.accessScope === "branches" && branches.length > 1 && <label className="text-sm font-medium text-slate-700">Branch
        <select className={fieldClass} value={branchId} onChange={(event) => { setBranchId(event.target.value); workspaceScope.selectBranch(event.target.value); }}>
          <option value="">{selectedInstitute?.accessScope === "branches" ? "Choose an assigned branch" : "All accessible branches"}</option>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </label>}
      <label className="text-sm font-medium text-slate-700">Payroll month
        <input className={fieldClass} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
      </label>
    </div>

    {selectedInstitute?.accessScope === "branches" && !branchId && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Choose one of your assigned active branches to view payroll.</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle size={17} className="mt-0.5 shrink-0" /><span>{error}</span></div>}

    {canRead && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Staff on payroll</p><p className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-900"><Users size={18} /> {rows.length}</p></div>
        <div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-amber-700">Unpaid payable</p><p className="mt-1 text-xl font-bold text-amber-900">{money(unpaidTotalCents / 100)}</p></div>
        <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Recorded salary payments</p><p className="mt-1 text-xl font-bold text-emerald-900">{money(paidTotalCents / 100)}</p></div>
      </div>
      <label className="block max-w-sm text-sm font-medium text-slate-700">Search staff
        <input className={fieldClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or designation" />
      </label>
      {loading ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} /> Loading shared payroll…</div>
        : filteredRows.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center"><Users className="mx-auto text-slate-400" /><p className="mt-2 font-semibold text-slate-800">No staff records found</p><p className="mt-1 text-sm text-slate-500">No active staff match this workspace and month.</p></div>
          : <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">{filteredRows.map((row) => <article key={row.staffId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-semibold text-slate-900">{row.name}</p><p className="mt-1 text-xs text-slate-500">{row.designation || "Staff"}{row.unpaidDays ? ` · ${row.unpaidDays} unpaid days · ${money(row.attendanceDeduction)} attendance deduction` : ""}</p></div>
            <div className="flex flex-wrap items-center gap-3"><div className="text-right"><p className="text-xs text-slate-500">Payable</p><p className="font-bold text-slate-900">{money(row.payableAmount)}</p></div>
              {row.payment ? <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"><CheckCircle2 size={16} /> Paid {money(row.payment.amount)}</div>
                : <button type="button" disabled={row.payableAmount <= 0 || saving} onClick={() => { setSelected(row); setMethod("Bank Transfer"); setReference(""); setConfirmAlreadyPaid(false); setError(""); }} className="inline-flex items-center gap-2 rounded-xl bg-[#5B21B6] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Banknote size={16} /> Record salary</button>}
            </div>
          </article>)}</div>}
    </>}

    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setSelected(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="payroll-dialog-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-violet-50 p-2 text-violet-700"><Clock3 size={18} /></span><div><h3 id="payroll-dialog-title" className="font-bold text-slate-900">Record salary payment</h3><p className="mt-1 text-sm text-slate-600">{selected.name} · {month}</p></div></div>
        <form onSubmit={recordPayment} className="mt-4 space-y-3">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Current database payable</p><p className="mt-1 text-lg font-bold text-slate-900">{money(selected.payableAmount)}</p></div>
          <label className="block text-sm font-medium text-slate-700">Manual payment method<select className={fieldClass} value={method} onChange={(event) => setMethod(event.target.value as (typeof METHODS)[number])}>{METHODS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="block text-sm font-medium text-slate-700">Reference (optional)<input className={fieldClass} maxLength={100} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          <p className="text-xs leading-5 text-slate-500">This records an offline salary payment in the institute database; it does not transfer money. The database rechecks staff access, attendance deductions, amount, and duplicate salary records before saving.</p>
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><input required type="checkbox" checked={confirmAlreadyPaid} onChange={(event) => setConfirmAlreadyPaid(event.target.checked)} className="mt-0.5 accent-violet-700" /><span>I confirm this salary was already paid using the selected method.</span></label>
          <div className="flex justify-end gap-2 pt-2"><button type="button" disabled={saving} onClick={() => { setSelected(null); setConfirmAlreadyPaid(false); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={saving || !canRead || !confirmAlreadyPaid} className="rounded-xl bg-[#5B21B6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Confirm payment"}</button></div>
        </form>
      </section>
    </div>}
  </section>;
}
