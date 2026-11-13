"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Clock3, RefreshCw, ShieldAlert } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  isAuthorizedTestProjectConfigured,
  loadWorkspaceBranches,
  loadWorkspaceInstitutes,
  type WorkspaceBranch,
  type WorkspaceInstitute,
} from "@/lib/supabase/workspace-scope";

type ReminderLog = {
  id: string;
  branch_id: string | null;
  channel: "Email" | "WhatsApp";
  delivery_status: "Queued" | "Processing" | "Sent" | "Delivered" | "Failed" | "Unknown" | "Skipped";
  provider: string | null;
  reminder_number: number | null;
  reminder_due_date: string | null;
  attempt_count: number;
  retryable: boolean;
  last_error_code: string | null;
  sent_at: string | null;
  attempted_at: string;
};

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100";

function displayDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN");
}

function statusTone(status: ReminderLog["delivery_status"]): string {
  if (status === "Sent" || status === "Delivered") return "bg-emerald-50 text-emerald-700";
  if (status === "Failed") return "bg-rose-50 text-rose-700";
  if (status === "Queued" || status === "Processing") return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

export default function ReminderStatusPage() {
  const projectAllowed = isAuthorizedTestProjectConfigured();
  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [branches, setBranches] = useState<WorkspaceBranch[]>([]);
  const [branchesInstituteId, setBranchesInstituteId] = useState("");
  const [instituteId, setInstituteId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [logsResult, setLogsResult] = useState<{ scope: string; rows: ReminderLog[] } | null>(null);
  const [scopeLoading, setScopeLoading] = useState(projectAllowed);
  const [errorResult, setErrorResult] = useState<{ scope: string; message: string } | null>(null);
  const [reloadNumber, setReloadNumber] = useState(0);
  const scope = `${instituteId}|${branchId}`;
  const logs = useMemo(() => logsResult?.scope === scope ? logsResult.rows : [], [logsResult, scope]);
  const error = errorResult?.scope === scope || errorResult?.scope === instituteId ? errorResult.message : "";
  const loading = projectAllowed && !!instituteId && logsResult?.scope !== scope && !error;

  function handleRefresh() {
    if (!projectAllowed || !instituteId) return;
    setLogsResult(null);
    setErrorResult(null);
    setReloadNumber((value) => value + 1);
  }

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
    if (!projectAllowed || !instituteId) return;
    let query = createSupabaseBrowserClient()
      .from("notification_logs")
      .select("id, branch_id, channel, delivery_status, provider, reminder_number, reminder_due_date, attempt_count, retryable, last_error_code, sent_at, attempted_at")
      .eq("institute_id", instituteId)
      .eq("event_type", "installment_reminder")
      .order("attempted_at", { ascending: false })
      .limit(100);
    if (branchId) query = query.eq("branch_id", branchId);
    void (async () => {
      try {
        const { data, error: queryError } = await query;
        if (!active) return;
        if (queryError) {
          setErrorResult({ scope, message: "Reminder history is unavailable for this account or database version." });
          return;
        }
        setLogsResult({ scope, rows: (data ?? []) as ReminderLog[] });
        setErrorResult(null);
      } catch {
        if (active) setErrorResult({ scope, message: "Reminder history could not be loaded." });
      }
    })();
    return () => { active = false; };
  }, [branchId, instituteId, projectAllowed, reloadNumber, scope]);

  const visibleBranches = useMemo(() => branchesInstituteId === instituteId ? branches : [], [branchesInstituteId, branches, instituteId]);
  const branchNames = useMemo(() => new Map(visibleBranches.map((branch) => [branch.id, branch.name])), [visibleBranches]);
  const selectedInstitute = institutes.find((item) => item.id === instituteId);
  const deliveryCounts = useMemo(() => logs.reduce((counts, item) => {
    counts[item.delivery_status] = (counts[item.delivery_status] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>), [logs]);

  return (
    <WorkspaceLayout>
      <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <header className="relative isolate overflow-hidden rounded-[18px] bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#86198f] px-4 py-3 text-white sm:rounded-3xl sm:px-5 sm:py-4">
          <div className="pointer-events-none absolute -right-14 -top-24 size-52 rounded-full border border-white/10 bg-white/[0.035]" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-28 right-20 size-40 rounded-full border border-white/10" aria-hidden="true" />
          <div className="relative z-10 flex flex-row items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-violet-100">
                <span className="size-2 rounded-full bg-emerald-300" aria-hidden="true" /> BIZBOOK · ACCOUNTS
              </p>
              <h1 className="mt-1.5 text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">
                <span className="text-white">Reminder </span><span className="bg-gradient-to-r from-amber-200 via-pink-200 to-cyan-200 bg-clip-text text-transparent">status</span>
              </h1>
              <p className="mt-1 hidden max-w-xl text-xs leading-5 text-violet-100 sm:block sm:text-sm">
                Reminder delivery attempts for your institute. Recipient addresses and message contents are hidden.
              </p>
            </div>
            <div className="relative z-10 w-[138px] shrink-0 rounded-[11px] border border-white/20 bg-white/10 p-2 backdrop-blur-sm sm:w-[176px] sm:rounded-[18px] sm:p-2.5">
              <span className="block text-[9px] font-bold uppercase tracking-[0.13em] text-violet-100 sm:text-[10px]">Reminder history</span>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || scopeLoading || !projectAllowed || !instituteId}
                className="mt-1.5 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white px-2 py-1.5 text-xs font-semibold text-slate-900 outline-none transition hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10 sm:rounded-[11px] sm:px-3 sm:text-sm"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
          <div className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-2.5 text-[11px] sm:text-xs">
            <p className="text-violet-100">Selected institute: <span className="font-bold text-white">{selectedInstitute?.name ?? (scopeLoading ? "Loading…" : "—")}</span></p>
            <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-violet-50">Reminder status</span>
          </div>
        </header>

        {!projectAllowed && <div role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Shared data is disabled unless this workspace targets the authorized test project.</div>}
        {error && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}

        {projectAllowed && <section className="mt-5 grid gap-3 sm:grid-cols-2">
          {institutes.length > 1 && <label className="text-xs font-semibold text-slate-600">Institute
              <select className={`${inputClass} mt-1`} value={instituteId} onChange={(event) => { setInstituteId(event.target.value); setBranchId(""); }}>
              {institutes.map((institute) => <option key={institute.id} value={institute.id}>{institute.name}</option>)}
            </select>
          </label>}
          {selectedInstitute?.accessScope === "branches" && visibleBranches.length > 1 && <label className="text-xs font-semibold text-slate-600">Assigned workspace
            <select className={`${inputClass} mt-1`} value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={!instituteId}>
              <option value="" disabled>Choose your assigned workspace</option>
              {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>}
        </section>}

        {projectAllowed && !scopeLoading && !institutes.length && <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No active institute membership is available for this account.</div>}
        {scopeLoading && <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Checking institute access…</div>}

        {projectAllowed && instituteId && <>
          <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Attempts shown</p><p className="mt-2 text-2xl font-bold text-[#5B21B6]">{logs.length}</p><p className="mt-1 text-[11px] text-slate-400">Latest 100 for {selectedInstitute?.name}</p></div>
            {(["Sent", "Delivered", "Failed"] as const).map((status) => <div key={status} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{status}</p><p className="mt-2 text-2xl font-bold text-[#5B21B6]">{deliveryCounts[status] ?? 0}</p><p className="mt-1 text-[11px] text-slate-400">Among the attempts shown</p></div>)}
          </section>

          <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3"><Bell size={17} className="text-[#7C3AED]" /><h2 className="text-sm font-bold text-slate-800">Recent delivery attempts</h2></div>
            {loading ? <p className="p-5 text-sm text-slate-500">Loading reminder history…</p> : logs.length === 0 ? <div className="p-6 text-center"><Clock3 className="mx-auto text-slate-400" size={22} /><p className="mt-2 text-sm font-semibold text-slate-700">No reminder attempts recorded</p><p className="mt-1 text-xs text-slate-500">This is based on saved delivery logs; it does not indicate that a provider is connected.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Attempted</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Schedule</th><th className="px-4 py-3">Channel</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Tries</th></tr></thead><tbody className="divide-y divide-slate-100">{logs.map((log) => <tr key={log.id}><td className="px-4 py-3 text-slate-600">{displayDate(log.attempted_at)}</td><td className="px-4 py-3 text-slate-600">{log.branch_id ? branchNames.get(log.branch_id) ?? "Accessible branch" : "Institute wide"}</td><td className="px-4 py-3 text-slate-600">{log.reminder_number ? `Reminder ${log.reminder_number}` : "—"}{log.reminder_due_date ? ` · due ${log.reminder_due_date}` : ""}</td><td className="px-4 py-3 text-slate-600">{log.channel}</td><td className="px-4 py-3 text-slate-600">{log.provider ?? "—"}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(log.delivery_status)}`}>{log.delivery_status}</span>{log.last_error_code && <p className="mt-1 text-[11px] text-rose-700">Code: {log.last_error_code}</p>}</td><td className="px-4 py-3 text-slate-600">{log.attempt_count}{log.retryable ? " · retryable" : ""}</td></tr>)}</tbody></table></div>}
          </section>
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldAlert size={15} className="mt-0.5 shrink-0" />This screen is read-only. Reminder sends are performed by the scheduled server workflow and require an active, verified provider setup.</p>
        </>}
      </main>
    </WorkspaceLayout>
  );
}
