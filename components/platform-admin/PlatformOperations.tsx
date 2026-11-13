"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Building2, CheckCircle2, CircleAlert, CreditCard, Database, FileText, Gift, LoaderCircle, RefreshCw, Search, ShieldCheck, Users, X } from "lucide-react";

type Institute = {
  id: string; business_name: string; owner_name: string | null; email: string | null; phone: string | null;
  created_at: string; account_status: "active" | "suspended"; suspension_reason: string | null;
  active_branches: number; active_students: number; active_staff: number;
  subscription_id: string | null; subscription_status: string | null; billing_cycle: string | null;
  free_access_enabled: boolean;
  current_period_end: string | null; grace_period_ends_at: string | null;
  plan_id: string | null; plan_name: string | null; student_limit: number | null; staff_limit: number | null; branch_limit: number | null;
};
type Plan = {
  id: string; name: string; description: string | null; monthly_price: number; annual_price: number;
  monthly_compare_at_price: number | null; annual_compare_at_price: number | null;
  trial_days: number; student_limit: number | null; staff_limit: number | null; branch_limit: number | null;
  features: Record<string, unknown>; is_available: boolean;
};
type Subscription = {
  id: string; institute_id: string; business_name: string; plan_id: string | null; plan_name: string | null;
  status: string; billing_cycle: string; trial_ends_at: string | null; current_period_start: string | null;
  current_period_end: string | null; grace_period_ends_at: string | null; updated_at: string;
};
type Invoice = {
  id: string; institute_id: string; business_name: string; invoice_number: string; amount: number;
  currency: string; status: string; due_at: string | null; paid_at: string | null; created_at: string;
};
type Attempt = {
  id: string; invoice_number: string; business_name: string; provider: string; provider_order_id: string | null;
  provider_payment_id: string | null; status: string; verified_at: string | null; safe_error_code: string | null; created_at: string;
};
type Admin = { user_id: string; role: "owner" | "operator" | "support"; created_at: string };
type Audit = { id: string; action: string; target_type: string; target_id: string | null; details: Record<string, unknown>; created_at: string };
type Diagnostics = {
  database: "available";
  projectGuard: "verified_test_project";
  serviceRoleKeyPresent: boolean;
  overviewRpcLatencyMs: number;
  checkedAt: string;
};
type Overview = {
  current_role: "owner" | "operator" | "support"; institute_total: number; institutes: Institute[]; plans: Plan[];
  subscriptions: Subscription[]; invoices: Invoice[]; payment_attempts: Attempt[]; administrators: Admin[];
  audit_events: Audit[]; subscription_events: Array<Record<string, unknown>>;
};
type Capabilities = { complimentaryAccess: boolean };

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:bg-slate-50";
const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6";
const selectClass = inputClass;
const statuses = ["trialing", "active", "past_due", "suspended", "cancelled", "expired"] as const;

function dateOrNull(value: string): string | null { return value ? new Date(value).toISOString() : null; }
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
function dateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function money(value: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}
function badgeClass(status: string): string {
  if (["active", "paid", "delivered", "owner"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (["suspended", "failed", "past_due", "expired"].includes(status)) return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-900";
}
function isOverview(value: unknown): value is Overview {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Array.isArray((value as Overview).institutes) && Array.isArray((value as Overview).plans));
}
function isDiagnostics(value: unknown): value is Diagnostics {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as Diagnostics).database === "available"
    && (value as Diagnostics).projectGuard === "verified_test_project"
    && typeof (value as Diagnostics).serviceRoleKeyPresent === "boolean"
    && Number.isFinite((value as Diagnostics).overviewRpcLatencyMs)
    && typeof (value as Diagnostics).checkedAt === "string");
}

export default function PlatformOperations({ requestedInstituteId = "" }: { requestedInstituteId?: string }) {
  const router = useRouter();
  const requestedInstituteApplied = useRef(false);
  const trialDefaultDaysRef = useRef("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({ complimentaryAccess: true });
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [suspensionReasons, setSuspensionReasons] = useState<Record<string, string>>({});
  const [adminUserId, setAdminUserId] = useState("");
  const [adminRole, setAdminRole] = useState<Admin["role"]>("operator");
  const [selectedInstituteId, setSelectedInstituteId] = useState(requestedInstituteId);
  const [subscriptionForm, setSubscriptionForm] = useState({ planId: "", status: "trialing", cycle: "monthly", trialDays: "", trialEnd: "", periodStart: "", periodEnd: "", graceEnd: "", reason: "" });
  const [invoiceForm, setInvoiceForm] = useState({ number: "", periodStart: "", periodEnd: "", dueAt: "" });
  const [freeAccessTarget, setFreeAccessTarget] = useState<{ institute: Institute; enabled: boolean } | null>(null);

  const refresh = useCallback(async (nextSearch = search) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (nextSearch) params.set("search", nextSearch);
      const response = await fetch(`/api/platform-admin/operations?${params.toString()}`, { cache: "no-store" });
      const result = await response.json() as { overview?: unknown; capabilities?: unknown; diagnostics?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error || "Platform records could not be loaded.");
      if (!isOverview(result.overview)) throw new Error("The platform response was incomplete.");
      if (!isDiagnostics(result.diagnostics)) throw new Error("Platform health details could not be verified.");
      setOverview(result.overview);
      if (requestedInstituteId && !requestedInstituteApplied.current) {
        const institute = result.overview.institutes.find((item) => item.id === requestedInstituteId);
        if (institute) {
          const subscription = result.overview.subscriptions.find((item) => item.institute_id === institute.id);
          requestedInstituteApplied.current = true;
          setSelectedInstituteId(institute.id);
          setSubscriptionForm({ planId: institute.plan_id ?? "", status: institute.subscription_status ?? "trialing", cycle: institute.billing_cycle ?? "monthly", trialDays: trialDefaultDaysRef.current, trialEnd: dateTimeLocalValue(subscription?.trial_ends_at), periodStart: dateTimeLocalValue(subscription?.current_period_start), periodEnd: dateTimeLocalValue(subscription?.current_period_end), graceEnd: dateTimeLocalValue(subscription?.grace_period_ends_at), reason: "" });
        }
      }
      setCapabilities({ complimentaryAccess: Boolean((result.capabilities as Capabilities | undefined)?.complimentaryAccess) });
      setDiagnostics(result.diagnostics);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Platform records could not be loaded.");
      return false;
    } finally { setLoading(false); }
  }, [search, requestedInstituteId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches the protected database snapshot after mount.
    void refresh("");
  }, [refresh]);

  useEffect(() => {
    let active = true;
    void fetch("/api/platform-admin/trials", { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { config?: { duration_days?: unknown } };
      if (active && response.ok && result.config && typeof result.config.duration_days === "number") {
        trialDefaultDaysRef.current = String(result.config.duration_days);
        setSubscriptionForm((current) => current.trialDays ? current : { ...current, trialDays: trialDefaultDaysRef.current });
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const isOwner = overview?.current_role === "owner";
  const canOperate = isOwner || overview?.current_role === "operator";
  const activeInstitutes = useMemo(() => overview?.institutes.filter((item) => item.account_status === "active").length ?? 0, [overview]);
  const openInvoices = useMemo(() => overview?.invoices.filter((item) => ["open", "past_due"].includes(item.status)).length ?? 0, [overview]);

  async function mutate(key: string, action: string, values: Record<string, unknown>, successMessage: string) {
    if (busyKey) return false;
    setBusyKey(key); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform-admin/operations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...values }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The requested platform change was rejected.");
      const refreshed = await refresh();
      setNotice(refreshed ? successMessage : `${successMessage} The write completed; refresh the page to load the latest records.`);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The platform operation failed.");
      return false;
    } finally { setBusyKey(""); }
  }

  async function submitSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInstituteId) return;
    if (!subscriptionForm.reason.trim()) { setError("Enter the reason for this manual subscription change so it is recorded in the audit history."); return; }
    if (subscriptionForm.status === "trialing" && !subscriptionForm.trialEnd && Number(subscriptionForm.trialDays) <= 0) {
      setError("Choose a trial length greater than zero or set a trial end date.");
      return;
    }
    const trialEnd = subscriptionForm.status !== "trialing" ? null : subscriptionForm.trialEnd
      ? dateOrNull(subscriptionForm.trialEnd)
      : new Date(Date.now() + Number(subscriptionForm.trialDays) * 86_400_000).toISOString();
    if (trialEnd && Date.parse(trialEnd) <= Date.now()) {
      setError("The trial end date must be in the future.");
      return;
    }
    await mutate(`subscription:${selectedInstituteId}`, "assign_subscription", {
      instituteId: selectedInstituteId, planId: subscriptionForm.planId || null, status: subscriptionForm.status,
      billingCycle: subscriptionForm.cycle, trialEndsAt: trialEnd,
      periodStart: dateOrNull(subscriptionForm.periodStart), periodEnd: dateOrNull(subscriptionForm.periodEnd),
      gracePeriodEndsAt: dateOrNull(subscriptionForm.graceEnd), reason: subscriptionForm.reason.trim(),
    }, "Subscription assignment saved and audited.");
  }

  async function submitInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInstituteId || !invoiceForm.number || !invoiceForm.periodStart || !invoiceForm.periodEnd) return;
    await mutate(`invoice:${selectedInstituteId}`, "issue_invoice", {
      instituteId: selectedInstituteId, invoiceNumber: invoiceForm.number,
      periodStart: dateOrNull(invoiceForm.periodStart), periodEnd: dateOrNull(invoiceForm.periodEnd), dueAt: dateOrNull(invoiceForm.dueAt),
    }, "Invoice issued as open. It has not been marked paid.");
  }

  async function confirmFreeAccess() {
    if (!freeAccessTarget) return;
    const { institute, enabled } = freeAccessTarget;
    const saved = await mutate(`free-access:${institute.id}`, "set_free_access", {
      instituteId: institute.id,
      enabled,
      reason: enabled ? "Complimentary subscription access confirmed in Company Admin." : "Complimentary subscription access revoked in Company Admin.",
    }, enabled
      ? `Complimentary access enabled for ${institute.business_name}. No payment was recorded.`
      : `Complimentary access removed for ${institute.business_name}.`);
    if (saved) setFreeAccessTarget(null);
  }

  return (
    <div className="space-y-8">
      <section id="platform-operations-overview" className="scroll-mt-28 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Platform operational summary">
        <SummaryCard label="Institute accounts" value={overview ? String(overview.institute_total) : loading ? "—" : "Unavailable"} detail={`${activeInstitutes} active in current result`} icon={Building2} />
        <SummaryCard label="Plans" value={overview ? String(overview.plans.length) : loading ? "—" : "Unavailable"} detail="Configured in the test database" icon={CreditCard} />
        <SummaryCard label="Open invoices" value={overview ? String(openInvoices) : loading ? "—" : "Unavailable"} detail="Open or past due; no paid status is inferred" icon={FileText} />
        <SummaryCard label="Platform administrators" value={overview ? String(overview.administrators.length) : loading ? "—" : "Unavailable"} detail="Roles are database-authorized" icon={Users} />
      </section>

      {diagnostics && <section id="system-health" className="rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-5 shadow-sm sm:p-6" aria-label="System health diagnostics">
        <SectionHeading icon={Activity} title="System health" description="Live server checks from the latest authorized database request. Secret values and provider credentials are never exposed here." />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Diagnostic label="Database" value="Available" detail={`Overview RPC: ${diagnostics.overviewRpcLatencyMs} ms`} icon={Database} />
          <Diagnostic label="Environment guard" value="Test project verified" detail="This console rejects other Supabase projects." icon={ShieldCheck} />
          <Diagnostic label="Service-role secret" value={diagnostics.serviceRoleKeyPresent ? "Present" : "Missing"} detail={diagnostics.serviceRoleKeyPresent ? "Presence only; key validity is not probed." : "Provider verification, reminders, and trusted provisioning need server-side setup."} icon={diagnostics.serviceRoleKeyPresent ? CheckCircle2 : CircleAlert} />
          <Diagnostic label="Last checked" value={formatDate(diagnostics.checkedAt)} detail={new Date(diagnostics.checkedAt).toLocaleTimeString()} icon={Activity} />
        </div>
      </section>}

      {!capabilities.complimentaryAccess && overview && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Complimentary access controls need the latest database migration. Other Company Admin records remain available.</p>}

      {error && <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2 text-sm text-rose-900"><CircleAlert size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div><button type="button" onClick={() => void refresh()} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-xs font-bold text-rose-900"><RefreshCw size={13} />Retry</button></div>}
      {notice && <div role="status" className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{notice}</div>}

      <section id="institute-directory" className="rounded-3xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-teal-50/70 p-5 shadow-sm sm:p-6">
        <SectionHeading icon={Building2} title="Institute directory" description="Database-backed account status, capacity usage and assigned plan. Suspension is enforced by tenant authorization policies." />
        <form onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); void refresh(searchInput.trim()); }} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1"><span className="sr-only">Search institutes</span><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input className={`${inputClass} pl-9`} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search by institute, email or ID" /></label>
          <button className="rounded-xl bg-[#5B21B6] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={loading}>Search</button>
          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh</button>
        </form>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[930px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Institute</th><th className="px-4 py-3">Account</th><th className="px-4 py-3">Usage</th><th className="px-4 py-3">Subscription</th><th className="px-4 py-3">Control</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {overview?.institutes.map((institute) => <tr key={institute.id} className="align-top">
                <td className="px-4 py-4"><p className="font-semibold text-slate-900">{institute.business_name}</p><p className="mt-1 text-xs text-slate-500">{institute.email || institute.phone || institute.id}</p><p className="mt-1 text-[11px] text-slate-400">Created {formatDate(institute.created_at)}</p></td>
                <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${badgeClass(institute.account_status)}`}>{institute.account_status}</span>{institute.suspension_reason && <p className="mt-2 max-w-[230px] text-xs text-rose-800">{institute.suspension_reason}</p>}</td>
                <td className="px-4 py-4 text-xs leading-6 text-slate-600">Students {institute.active_students}{institute.student_limit === null ? " / ∞" : ` / ${institute.student_limit}`}<br />Staff {institute.active_staff}{institute.staff_limit === null ? " / ∞" : ` / ${institute.staff_limit}`}<br />Branches {institute.active_branches}{institute.branch_limit === null ? " / ∞" : ` / ${institute.branch_limit}`}</td>
                <td className="px-4 py-4"><p className="font-medium text-slate-800">{institute.plan_name || "No plan assigned"}</p><p className="mt-1 text-xs capitalize text-slate-500">{institute.subscription_status || "No subscription"}{institute.billing_cycle ? ` · ${institute.billing_cycle}` : ""}</p><p className="mt-1 text-xs text-slate-500">Period ends {formatDate(institute.current_period_end)}</p>{institute.free_access_enabled && <span className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800">Complimentary access</span>}</td>
                <td className="px-4 py-4"><div className="min-w-[185px] space-y-2">
                    {institute.account_status === "active" ? <>
                    <input className={inputClass} aria-label={`Suspension reason for ${institute.business_name}`} placeholder="Reason required to suspend" value={suspensionReasons[institute.id] ?? ""} disabled={!canOperate || busyKey === `status:${institute.id}`} onChange={(event) => setSuspensionReasons((current) => ({ ...current, [institute.id]: event.target.value }))} />
                    <button type="button" disabled={!canOperate || !suspensionReasons[institute.id]?.trim() || Boolean(busyKey)} onClick={() => { if (window.confirm(`Suspend ${institute.business_name}? Tenant access will be blocked.`)) void mutate(`status:${institute.id}`, "set_institute_status", { instituteId: institute.id, status: "suspended", reason: suspensionReasons[institute.id] }, "Institute suspended; access checks are now enforced by the database."); }} className="w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 disabled:opacity-50">Suspend institute</button>
                  </> : <button type="button" disabled={!canOperate || Boolean(busyKey)} onClick={() => { if (window.confirm(`Reactivate ${institute.business_name}?`)) void mutate(`status:${institute.id}`, "set_institute_status", { instituteId: institute.id, status: "active", reason: "Reactivated by platform administrator" }, "Institute reactivated."); }} className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">Reactivate institute</button>}
                  <button type="button" disabled={!canOperate} onClick={() => router.push(`/platform-admin/subscriptions?institute=${encodeURIComponent(institute.id)}`)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">Manage subscription</button>
                  {institute.account_status === "active" && <button type="button" disabled={!canOperate || !capabilities.complimentaryAccess || Boolean(busyKey)} onClick={() => setFreeAccessTarget({ institute, enabled: !institute.free_access_enabled })} className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50 ${institute.free_access_enabled ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><Gift size={14} />{institute.free_access_enabled ? "Remove free access" : "Grant free access"}</button>}
                </div></td>
              </tr>)}
              {!loading && !error && overview?.institutes.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No institutes match this search.</td></tr>}
              {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500"><LoaderCircle size={16} className="mr-2 inline animate-spin" />Loading institute records…</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">An unassigned subscription remains uncapped. Setting plan limits below enforces them for active students, staff and branches; existing records are retained.</p>
      </section>

      <section id="subscription-plans" className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 via-indigo-50/70 to-white p-5 shadow-sm sm:p-6">
        <SectionHeading icon={CreditCard} title="Plan pricing" description="Manage the plan catalog, feature lists, usage limits, trial policy, and availability dates from the Company Admin console." />
        <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-blue-100 bg-white/90 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div><p className="text-sm font-bold text-slate-900">{overview?.plans.length ?? 0} configured plans</p><p className="mt-1 text-sm text-slate-600">Edit prices or add another named plan.</p></div>
          <Link href="/platform-admin/plans" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"><CreditCard size={16} />Open plan pricing</Link>
        </div>
      </section>
      <section id="subscription-assignment" className="rounded-3xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-yellow-50/70 p-5 shadow-sm sm:p-6">
        <SectionHeading icon={FileText} title="Subscription assignment and invoices" description="Assignments and invoices are audited. Issuing an invoice creates an open invoice from the assigned plan price; only verified provider reconciliation may mark it paid." />
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <form onSubmit={submitSubscription} className="space-y-4 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-900">Assign or update subscription</h3>
            <label className="block text-xs font-semibold text-slate-700">Institute<select className={`${selectClass} mt-1`} value={selectedInstituteId} onChange={(event) => setSelectedInstituteId(event.target.value)} required disabled={!canOperate || Boolean(busyKey)}><option value="">Select institute</option>{overview?.institutes.map((item) => <option key={item.id} value={item.id}>{item.business_name}</option>)}</select></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Plan<select className={`${selectClass} mt-1`} value={subscriptionForm.planId} onChange={(event) => setSubscriptionForm((s) => ({ ...s, planId: event.target.value }))} disabled={!canOperate || Boolean(busyKey)}><option value="">No plan</option>{overview?.plans.map((plan) => <option key={plan.id} value={plan.id} disabled={!plan.is_available && plan.id !== subscriptionForm.planId}>{plan.name}{plan.is_available ? "" : " (unavailable)"}</option>)}</select></label><label className="text-xs font-semibold text-slate-700">Status<select className={`${selectClass} mt-1`} value={subscriptionForm.status} onChange={(event) => setSubscriptionForm((s) => ({ ...s, status: event.target.value }))} disabled={!canOperate || Boolean(busyKey)}>{statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label></div>
            <label className="block text-xs font-semibold text-slate-700">Billing cycle<select className={`${selectClass} mt-1`} value={subscriptionForm.cycle} onChange={(event) => setSubscriptionForm((s) => ({ ...s, cycle: event.target.value }))} disabled={!canOperate || Boolean(busyKey)}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Grant trial (days)<input className={`${inputClass} mt-1`} type="number" min="1" max="365" step="1" value={subscriptionForm.trialDays} onChange={(event) => setSubscriptionForm((s) => ({ ...s, trialDays: event.target.value }))} disabled={!canOperate || Boolean(busyKey) || subscriptionForm.status !== "trialing"} /><span className="mt-1 block font-normal text-slate-500">Pre-filled from company trial settings; set a custom end date to override.</span></label><DateField label="Trial end override" value={subscriptionForm.trialEnd} onChange={(value) => setSubscriptionForm((s) => ({ ...s, trialEnd: value }))} /></div>
            <label className="block text-xs font-semibold text-slate-700">Reason for manual change<textarea className={`${inputClass} mt-1 min-h-20 resize-y`} value={subscriptionForm.reason} onChange={(event) => setSubscriptionForm((s) => ({ ...s, reason: event.target.value }))} maxLength={1000} required disabled={!canOperate || Boolean(busyKey)} placeholder="Explain why the plan, trial, or access status is changing." /></label>
            <div className="grid gap-3 sm:grid-cols-2"><DateField label="Period starts" value={subscriptionForm.periodStart} onChange={(value) => setSubscriptionForm((s) => ({ ...s, periodStart: value }))} /><DateField label="Period ends" value={subscriptionForm.periodEnd} onChange={(value) => setSubscriptionForm((s) => ({ ...s, periodEnd: value }))} /><DateField label="Grace period ends" value={subscriptionForm.graceEnd} onChange={(value) => setSubscriptionForm((s) => ({ ...s, graceEnd: value }))} /></div>
            <button disabled={!canOperate || !selectedInstituteId || Boolean(busyKey)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#5B21B6] px-4 text-sm font-bold text-white disabled:opacity-50">{busyKey.startsWith("subscription:") ? <LoaderCircle size={15} className="animate-spin" /> : null}Save subscription</button>
          </form>

          <form onSubmit={submitInvoice} className="space-y-4 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-900">Issue an open invoice</h3>
            <label className="block text-xs font-semibold text-slate-700">Institute<select className={`${selectClass} mt-1`} value={selectedInstituteId} onChange={(event) => setSelectedInstituteId(event.target.value)} required disabled={!canOperate || Boolean(busyKey)}><option value="">Select institute</option>{overview?.institutes.map((item) => <option key={item.id} value={item.id}>{item.business_name}</option>)}</select></label>
            <label className="block text-xs font-semibold text-slate-700">Invoice number<input className={`${inputClass} mt-1`} maxLength={64} value={invoiceForm.number} onChange={(event) => setInvoiceForm((s) => ({ ...s, number: event.target.value }))} required disabled={!canOperate || Boolean(busyKey)} /></label>
            <div className="grid gap-3 sm:grid-cols-2"><DateField label="Billing period starts" value={invoiceForm.periodStart} onChange={(value) => setInvoiceForm((s) => ({ ...s, periodStart: value }))} required /><DateField label="Billing period ends" value={invoiceForm.periodEnd} onChange={(value) => setInvoiceForm((s) => ({ ...s, periodEnd: value }))} required /><DateField label="Due at" value={invoiceForm.dueAt} onChange={(value) => setInvoiceForm((s) => ({ ...s, dueAt: value }))} /></div>
            <p className="text-xs leading-5 text-slate-500">Amount comes from the assigned plan and billing cycle. Tax handling is not configured. This action never marks an invoice paid.</p>
            <button disabled={!canOperate || !selectedInstituteId || Boolean(busyKey)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 disabled:opacity-50">{busyKey.startsWith("invoice:") ? <LoaderCircle size={15} className="animate-spin" /> : null}Issue invoice</button>
          </form>
        </div>
        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          <RecordList title="Recent invoices" empty="No subscription invoices have been issued." headers={["Invoice", "Institute", "Amount", "Status"]} rows={(overview?.invoices ?? []).map((item) => [item.invoice_number, item.business_name, money(item.amount, item.currency), item.status])} />
          <RecordList title="Payment attempts and reconciliation" empty="No provider-backed subscription payment attempts are recorded." headers={["Invoice", "Provider", "Status", "Verified"]} rows={(overview?.payment_attempts ?? []).map((item) => [item.invoice_number, item.provider, item.status, formatDate(item.verified_at)])} />
        </div>
      </section>

      <section id="platform-access" className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50/70 p-5 shadow-sm sm:p-6">
        <SectionHeading icon={ShieldCheck} title="Platform administrator access" description="No default user or browser bootstrap exists. The first owner is provisioned through a server-only trusted operation; owners can then add or manage verified Auth user UUIDs." />
        <form onSubmit={async (event) => { event.preventDefault(); const userId = adminUserId.trim(); if (!userId) return; const ok = await mutate(`admin:${userId}`, "set_admin_role", { userId, role: adminRole }, "Platform administrator access was saved and audited."); if (ok) setAdminUserId(""); }} className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-xs font-semibold text-slate-700">Verified Supabase Auth user UUID<input className={`${inputClass} mt-1`} value={adminUserId} onChange={(event) => setAdminUserId(event.target.value)} placeholder="UUID from the trusted Auth directory" required disabled={!isOwner || Boolean(busyKey)} /></label>
          <label className="text-xs font-semibold text-slate-700">Role<select className={`${selectClass} mt-1 min-w-36`} value={adminRole} onChange={(event) => setAdminRole(event.target.value as Admin["role"])} disabled={!isOwner || Boolean(busyKey)}><option value="operator">Operator</option><option value="support">Support</option><option value="owner">Owner</option></select></label>
          <button disabled={!isOwner || !adminUserId.trim() || Boolean(busyKey)} className="min-h-10 rounded-xl bg-[#5B21B6] px-4 text-sm font-bold text-white disabled:opacity-50">Grant or update role</button>
        </form>
        {!isOwner && <p className="mt-3 text-xs text-slate-500">Only a platform owner can add, remove or change platform roles.</p>}
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Auth user UUID</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Added</th><th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{overview?.administrators.map((admin) => <tr key={admin.user_id}><td className="px-4 py-3 font-mono text-xs text-slate-600">{admin.user_id}</td><td className="px-4 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${badgeClass(admin.role)}`}>{admin.role}</span></td><td className="px-4 py-3 text-xs text-slate-500">{formatDate(admin.created_at)}</td><td className="px-4 py-3"><div className="flex items-center gap-2"><select aria-label={`Role for ${admin.user_id}`} className={`${selectClass} max-w-32 py-1.5 text-xs`} value={admin.role} disabled={!isOwner || Boolean(busyKey)} onChange={(event) => void mutate(`admin:${admin.user_id}`, "set_admin_role", { userId: admin.user_id, role: event.target.value }, "Platform administrator role updated.")}>{["owner", "operator", "support"].map((role) => <option key={role} value={role}>{role}</option>)}</select><button type="button" disabled={!isOwner || Boolean(busyKey)} onClick={() => { if (window.confirm(`Remove platform access for ${admin.user_id}?`)) void mutate(`admin:${admin.user_id}`, "remove_admin", { userId: admin.user_id }, "Platform administrator removed."); }} className="rounded-lg border border-rose-200 px-2.5 py-2 text-xs font-semibold text-rose-800 disabled:opacity-50">Remove</button></div></td></tr>)}{!loading && overview?.administrators.length === 0 && <tr><td colSpan={4} className="px-4 py-7 text-center text-sm text-slate-500">No platform administrator is provisioned. Use the trusted first-owner provisioning procedure described below.</td></tr>}</tbody></table></div>
      </section>

      <section id="platform-audit" className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-100 via-white to-blue-50/70 p-5 shadow-sm sm:p-6">
        <SectionHeading icon={FileText} title="Administrative audit history" description="Recent plan, account, subscription and administrator operations recorded in the database." />
        <div className="mt-4"><RecordList title="Recent platform changes" empty="No administrative events have been recorded." headers={["Action", "Target", "Reference", "Date"]} rows={(overview?.audit_events ?? []).map((item) => [item.action.replaceAll("_", " "), item.target_type.replaceAll("_", " "), item.target_id || "—", formatDate(item.created_at)])} /></div>
        <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-xs leading-5 text-violet-950"><strong>First owner provisioning:</strong> create a trusted server environment with the test project URL, server-only service role key and a manually verified Auth user UUID, then run the repository provisioning script. The script refuses any non-test project and there is no browser bootstrap route.</div>
      </section>

      {!loading && !error && overview && <p className="text-xs text-slate-500">Loaded platform records from the authorized test database. {overview.institute_total} institute records match the current directory filter. Payment attempts are database history; live provider operations remain disabled.</p>}
      {freeAccessTarget && <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyKey) setFreeAccessTarget(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="free-access-title" className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-5 shadow-2xl sm:p-6">
          <div className="flex items-start gap-3"><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${freeAccessTarget.enabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}><Gift size={19} /></span><div className="min-w-0 flex-1"><h2 id="free-access-title" className="text-base font-extrabold text-slate-950">{freeAccessTarget.enabled ? "Grant complimentary access?" : "Remove complimentary access?"}</h2><p className="mt-1 break-words text-sm font-semibold text-slate-700">{freeAccessTarget.institute.business_name}</p></div><button type="button" aria-label="Close confirmation" disabled={Boolean(busyKey)} onClick={() => setFreeAccessTarget(null)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-50"><X size={17} /></button></div>
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">{freeAccessTarget.enabled
            ? "This institute can use BizBook without paying for a subscription while complimentary access is enabled. This does not create or mark any payment as paid."
            : "This removes the payment waiver. If the institute has no active paid plan or trial, its workspace will return to the plan renewal screen."}</p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={Boolean(busyKey)} onClick={() => setFreeAccessTarget(null)} className="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 disabled:opacity-50">Cancel</button><button type="button" disabled={Boolean(busyKey)} onClick={() => void confirmFreeAccess()} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold text-white disabled:opacity-60 ${freeAccessTarget.enabled ? "bg-emerald-700 hover:bg-emerald-800" : "bg-amber-700 hover:bg-amber-800"}`}>{busyKey.startsWith("free-access:") ? <LoaderCircle size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{freeAccessTarget.enabled ? "Yes, I confirm" : "Yes, remove access"}</button></div>
        </section>
      </div>}
    </div>
  );
}

function SummaryCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Building2 }) {
  const themes: Record<string, { card: string; icon: string }> = {
    "Institute accounts": { card: "border-violet-100 bg-gradient-to-br from-violet-50/70 to-white", icon: "bg-violet-100 text-violet-800" },
    Plans: { card: "border-blue-100 bg-gradient-to-br from-blue-50/70 to-white", icon: "bg-blue-100 text-blue-800" },
    "Open invoices": { card: "border-amber-100 bg-gradient-to-br from-amber-50/70 to-white", icon: "bg-amber-100 text-amber-800" },
    "Platform administrators": { card: "border-emerald-100 bg-gradient-to-br from-emerald-50/70 to-white", icon: "bg-emerald-100 text-emerald-800" },
  };
  const theme = themes[label] ?? { card: "border-slate-200 bg-white", icon: "bg-slate-100 text-slate-700" };
  return <article className={`${cardClass} ${theme.card}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">{label}</p><p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">{value}</p></div><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${theme.icon}`}><Icon size={19} /></span></div><p className="mt-3 text-xs text-slate-500">{detail}</p></article>;
}
function Diagnostic({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Building2 }) {
  return <article className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-2 break-words text-sm font-bold text-slate-900">{value}</p></div><Icon size={17} className="shrink-0 text-slate-500" /></div><p className="mt-2 text-xs leading-5 text-slate-600">{detail}</p></article>;
}
function SectionHeading({ icon: Icon, title, description }: { icon: typeof Building2; title: string; description: string }) {
  const themes: Record<string, string> = {
    "System health": "border-sky-100 bg-sky-50/80",
    "Institute directory": "border-cyan-100 bg-cyan-50/80",
    "Plan pricing": "border-blue-100 bg-blue-50/80",
    "Subscription assignment and invoices": "border-orange-200 bg-orange-50/90",
    "Platform administrator access": "border-violet-100 bg-violet-50/80",
    "Administrative audit history": "border-slate-200 bg-slate-100/80",
  };
  const iconThemes: Record<string, string> = {
    "System health": "bg-white text-sky-700",
    "Institute directory": "bg-white text-cyan-700",
    "Plan pricing": "bg-white text-blue-700",
    "Subscription assignment and invoices": "bg-white text-orange-700",
    "Platform administrator access": "bg-white text-violet-700",
    "Administrative audit history": "bg-white text-slate-700",
  };
  return <header className={`flex items-start gap-3 rounded-2xl border p-4 sm:p-5 ${themes[title] ?? "border-slate-200 bg-slate-50"}`}><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ${iconThemes[title] ?? "bg-white text-slate-700"}`}><Icon size={18} /></span><div><h2 className="text-lg font-bold tracking-tight text-slate-950">{title}</h2><p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">{description}</p></div></header>;
}
function DateField({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="text-xs font-semibold text-slate-700">{label}<input className={`${inputClass} mt-1`} type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>;
}
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-8 text-center text-sm text-slate-500">{text}</p>; }
function RecordList({ title, empty, headers, rows }: { title: string; empty: string; headers: string[]; rows: string[][] }) {
  return <section><h3 className="mb-2 text-sm font-bold text-slate-900">{title}</h3>{rows.length === 0 ? <Empty text={empty} /> : <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>{headers.map((header) => <th key={header} className="px-3 py-2.5">{header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`} className="px-3 py-3 text-slate-700">{cell}</td>)}</tr>)}</tbody></table></div>}</section>;
}
