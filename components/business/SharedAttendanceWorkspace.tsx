"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Save, Users } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { isAuthorizedTestProjectConfigured } from "@/lib/supabase/workspace-scope";
import { calculatePayrollPayable } from "@/lib/supabase/payroll";

type Status = "Present" | "Absent" | "Leave" | "Holiday";
type Role = "owner" | "administrator" | "accountant" | "staff";
type Membership = { instituteId: string; instituteName: string; role: Role; accessScope: "institute" | "branches" };
type Branch = { id: string; name: string };
type StaffRow = {
  id: string; institute_id: string; branch_id: string | null; name: string;
  designation: string | null; joining_date: string | null;
  salary_calculation_mode: "AttendanceBased" | "Fixed"; attendance_enabled: boolean;
};
type CompensationRow = {
  id: string; monthly_salary: number; per_day_leave_cut: number;
  manual_payable_amount: number | null; salary_calculation_mode: "AttendanceBased" | "Fixed";
  attendance_enabled: boolean; joining_date: string | null;
};

const rowKey = (staffId: string, date: string) => `${staffId}__${date}`;
const todayString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const dateInTimeZone = (timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const money = (amount: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(amount);

async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null; count: number | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset <= 100_000; offset += 1_000) {
    const { data, error, count } = await fetchPage(offset, offset + 999);
    if (error) throw new Error("The shared attendance records could not be loaded.");
    rows.push(...(data ?? []));
    if (!data?.length || data.length < 1_000 || (count !== null && rows.length >= count)) return rows;
  }
  throw new Error("Too many attendance records to load at once; narrow the branch filter.");
}

export default function SharedAttendanceWorkspace({ onBack }: { onBack?: () => void } = {}) {
  const workspaceScope = useWorkspaceScope();
  const setWorkspaceBlocker = workspaceScope.setBlocker;
  const saveActionRef = useRef<HTMLElement | null>(null);
  const bottomSaveActionRef = useRef<HTMLDivElement | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [selectedInstituteId, setSelectedInstituteId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("all");
  const [month, setMonth] = useState("");
  const [today, setToday] = useState("");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [compensation, setCompensation] = useState<Map<string, CompensationRow>>(new Map());
  const [attendance, setAttendance] = useState<Record<string, Status>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const membership = memberships.find((item) => item.instituteId === selectedInstituteId);
  const accessScope = membership?.accessScope;
  const role = membership?.role;
  const canViewFinance = membership && ["owner", "administrator", "accountant"].includes(membership.role);
  const scopePending = workspaceScope.loading || (!!workspaceScope.selection
    && memberships.some((item) => item.instituteId === workspaceScope.selection?.instituteId)
    && (selectedInstituteId !== workspaceScope.selection.instituteId || (branchId === "all" ? "" : branchId) !== workspaceScope.selection.branchId));

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const next = workspaceScope.selection;
      if (!next || !memberships.some((item) => item.instituteId === next.instituteId)) return;
      setSelectedInstituteId(next.instituteId);
      setBranchId(next.branchId || "all");
      setSelectedStaffId("");
      setError("");
    });
    return () => { active = false; };
  }, [memberships, workspaceScope.selection]);

  useEffect(() => {
    setWorkspaceBlocker(dirty.size > 0 || saving ? "Save or discard the attendance edits before switching institute or branch." : "");
    return () => setWorkspaceBlocker("");
  }, [dirty.size, saving, setWorkspaceBlocker]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const currentDate = todayString();
      setToday(currentDate);
      setMonth(currentDate.slice(0, 7));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!isAuthorizedTestProjectConfigured()) {
        if (active) { setError("Shared attendance is enabled only for the authorized test project."); setLoading(false); }
        return;
      }
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) throw new Error("Sign in to load shared attendance.");
        const { data: rows, error: membershipError } = await supabase.from("user_memberships")
          .select("institute_id, role, access_scope").eq("user_id", auth.user.id).eq("is_active", true);
        if (membershipError) throw new Error("Institute access could not be loaded.");
        const ids = (rows ?? []).map((row) => row.institute_id);
        if (!ids.length) { if (active) setMemberships([]); return; }
        const { data: institutes, error: instituteError } = await supabase.from("coaching_institutes")
          .select("id, business_name").in("id", ids);
        if (instituteError) throw new Error("Institute details could not be loaded.");
        const names = new Map((institutes ?? []).map((row) => [row.id, row.business_name]));
        const options = (rows ?? []).flatMap((row) => {
          const name = names.get(row.institute_id);
          return name ? [{ instituteId: row.institute_id, instituteName: name, role: row.role, accessScope: row.access_scope }] : [];
        });
        if (!active) return;
        setMemberships(options);
        setSelectedInstituteId((current) => options.some((item) => item.instituteId === current) ? current : options[0]?.instituteId ?? "");
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Institute access could not be loaded.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!selectedInstituteId) return () => { active = false; };
    void (async () => {
      const { data, error: branchError } = await createSupabaseBrowserClient().from("branches")
        .select("id, name").eq("institute_id", selectedInstituteId).eq("is_active", true).order("name");
      if (!active) return;
      if (branchError) { setError("Branches could not be loaded for this institute."); setBranches([]); return; }
      const available = data ?? [];
      setBranches(available);
      if (accessScope === "branches") {
        setBranchId((current) => available.some((branch) => branch.id === current) ? current : available[0]?.id ?? "");
      } else {
        setBranchId((current) => current === "all" || available.some((branch) => branch.id === current) ? current : "all");
      }
    })();
    return () => { active = false; };
  }, [selectedInstituteId, accessScope]);

  useEffect(() => {
    let active = true;
    if (scopePending || !selectedInstituteId || !month || !role || (accessScope === "branches" && (branchId === "all" || !branchId))) return () => { active = false; };
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: institute, error: timeZoneError } = await supabase.from("coaching_institutes")
          .select("time_zone").eq("id", selectedInstituteId).maybeSingle();
        if (timeZoneError || !institute) throw new Error("Institute business date could not be verified.");
        setToday(dateInTimeZone(institute.time_zone));
        const [yearText, monthText] = month.split("-");
        const monthStart = `${month}-01`;
        const nextMonth = new Date(Date.UTC(Number(yearText), Number(monthText), 1)).toISOString().slice(0, 10);
        const staffRows = await readAllPages((from, to) => {
          let query = supabase.from("staff").select("id, institute_id, branch_id, name, designation, joining_date, salary_calculation_mode, attendance_enabled", { count: "exact" })
            .eq("institute_id", selectedInstituteId).is("archived_at", null).order("name").order("id");
          if (branchId !== "all") query = query.eq("branch_id", branchId);
          return query.range(from, to);
        });
        const [attendanceRows, compensationRows] = await Promise.all([
          readAllPages((from, to) => {
            let query = supabase.from("attendance_records").select("staff_id, attendance_date, status", { count: "exact" })
              .eq("institute_id", selectedInstituteId).gte("attendance_date", monthStart).lt("attendance_date", nextMonth)
              .order("attendance_date").order("staff_id");
            if (branchId !== "all") query = query.eq("branch_id", branchId);
            return query.range(from, to);
          }),
          canViewFinance ? supabase.rpc("list_staff_compensation", {
            p_institute_id: selectedInstituteId,
            p_branch_id: branchId === "all" ? null : branchId,
          }).then(({ data, error: compensationError }) => {
            if (compensationError) throw new Error("Finance-authorized salary settings could not be loaded.");
            return data ?? [];
          }) : Promise.resolve([]),
        ]);
        if (!active) return;
        const statusMap: Record<string, Status> = {};
        for (const row of attendanceRows) statusMap[rowKey(row.staff_id, row.attendance_date)] = row.status;
        setStaff(staffRows);
        setAttendance(statusMap);
        setDirty(new Set());
        setCompensation(new Map(compensationRows.map((row) => [row.id, row])));
        setSelectedStaffId((current) => staffRows.some((row) => row.id === current) ? current : staffRows[0]?.id ?? "");
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Shared attendance could not be loaded.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [selectedInstituteId, month, branchId, role, accessScope, canViewFinance, scopePending]);

  const selectedStaff = staff.find((item) => item.id === selectedStaffId) ?? null;
  const [year, monthNumber] = (month || "2000-01").split("-").map(Number);
  const totalDays = new Date(year, monthNumber, 0).getDate();
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const dates = month ? Array.from({ length: totalDays }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`) : [];
  const editableDates = dates.filter((date) => date <= today);
  const selectedAttendance = selectedStaff
    ? dates.flatMap((date) => {
      const status = attendance[rowKey(selectedStaff.id, date)];
      return status ? [{ attendance_date: date, status }] : [];
    }) : [];
  const selectedCompensation = selectedStaff ? compensation.get(selectedStaff.id) : undefined;
  const payable = selectedCompensation
    ? calculatePayrollPayable(selectedCompensation, selectedAttendance, month)
    : null;

  function setStatus(date: string, status: Status) {
    if (!selectedStaff || date > today) return;
    const key = rowKey(selectedStaff.id, date);
    setAttendance((current) => ({ ...current, [key]: status }));
    setDirty((current) => new Set(current).add(key));
    setNotice("");
    window.setTimeout(() => bottomSaveActionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  function markAllPresent() {
    if (!selectedStaff) return;
    setAttendance((current) => {
      const next = { ...current };
      editableDates.forEach((date) => { next[rowKey(selectedStaff.id, date)] = "Present"; });
      return next;
    });
    setDirty((current) => {
      const next = new Set(current);
      editableDates.forEach((date) => next.add(rowKey(selectedStaff.id, date)));
      return next;
    });
    window.setTimeout(() => bottomSaveActionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  async function save() {
    if (!selectedInstituteId || !dirty.size || scopePending) return;
    setSaving(true);
    setError("");
    setNotice("");
    const pending = [...dirty].flatMap((key) => {
      const splitAt = key.lastIndexOf("__");
      const staffId = key.slice(0, splitAt);
      const date = key.slice(splitAt + 2);
      const person = staff.find((row) => row.id === staffId);
      const status = attendance[key];
      return person && status ? [{ institute_id: selectedInstituteId, branch_id: person.branch_id, staff_id: staffId, attendance_date: date, status }] : [];
    });
    try {
      if (pending.length) {
        const { error: saveError } = await createSupabaseBrowserClient().from("attendance_records")
          .upsert(pending, { onConflict: "institute_id,staff_id,attendance_date" });
        if (saveError) {
          setError(saveError.code === "42501" ? "Your role or branch access does not allow this attendance change." : saveError.code === "23514" ? saveError.message : "Attendance was not saved. Reload and retry; no success was recorded.");
          return;
        }
      }
      setDirty(new Set());
      setNotice(`${pending.length} attendance record${pending.length === 1 ? "" : "s"} saved to the shared database.`);
    } catch {
      setError("Attendance was not saved. Check the connection and reload before retrying.");
    } finally { setSaving(false); }
  }

  function changeMonth(delta: number) {
    const next = new Date(year, monthNumber - 1 + delta, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  }

  const count = (status: Status) => selectedStaff
    ? dates.filter((date) => attendance[rowKey(selectedStaff.id, date)] === status).length : 0;

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_#f3e8ff_0%,_#f8fafc_42%,_#eef2ff_100%)] px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-6xl space-y-4 sm:space-y-5">
        <header ref={saveActionRef} className="relative scroll-mt-4 overflow-hidden rounded-[24px] bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#a21caf] p-5 text-white shadow-[0_18px_45px_rgba(91,33,182,0.20)] sm:rounded-[28px] sm:p-7">
          <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-24 h-64 w-64 rounded-full border border-white/15" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 right-1/4 h-72 w-72 rounded-full border border-white/10" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-violet-100 sm:text-[11px]">
                <span className="h-2 w-2 rounded-full bg-emerald-300" /> BizBook · People
              </span>
              <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.04em] sm:text-3xl">Staff <span className="text-fuchsia-200">Attendance</span></h1>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-violet-100/90 sm:text-sm">Record daily attendance with your institute&apos;s time zone and shared staff records.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onBack && <button type="button" onClick={onBack} disabled={dirty.size > 0 || saving} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/25 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50">Back</button>}
              <button type="button" onClick={save} disabled={loading || scopePending || saving || !dirty.size} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-violet-800 shadow-lg shadow-purple-950/10 transition hover:-translate-y-0.5 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"><Save size={15} />{saving ? "Saving…" : dirty.size ? `Save ${dirty.size} change${dirty.size === 1 ? "" : "s"}` : "All changes saved"}</button>
            </div>
          </div>
          <div className="relative mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-3 text-xs text-violet-100 sm:text-sm">
            <span>Shared attendance · Institute time zone applies</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 font-semibold"><CalendarDays size={14} />{month ? new Date(year, monthNumber - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "Loading month…"}</span>
          </div>
        </header>

        {!isAuthorizedTestProjectConfigured() && <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 shadow-sm">Shared attendance is unavailable unless this workspace uses the approved test project.</p>}
        {error && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 shadow-sm">{error}</p>}
        {notice && <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 shadow-sm">{notice}</p>}

        {(memberships.length > 1 || (membership?.accessScope === "branches" && branches.length > 1)) && <section className="grid gap-3 rounded-2xl border border-violet-100 bg-white/90 p-3 shadow-sm sm:grid-cols-2 sm:p-4">
          {memberships.length > 1 && <label className="text-xs font-bold text-slate-600">Institute
            <select value={selectedInstituteId} disabled={dirty.size > 0 || saving} onChange={(event) => { setSelectedInstituteId(event.target.value); void workspaceScope.selectInstitute(event.target.value); }} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100 disabled:opacity-60" aria-label="Attendance institute">
              {memberships.map((item) => <option key={item.instituteId} value={item.instituteId}>{item.instituteName}</option>)}
            </select>
          </label>}
          {membership?.accessScope === "branches" && branches.length > 1 && <label className="text-xs font-bold text-slate-600">Branch
            <select value={branchId} disabled={dirty.size > 0 || saving} onChange={(event) => { setBranchId(event.target.value); workspaceScope.selectBranch(event.target.value); }} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100 disabled:opacity-60" aria-label="Assigned workspace">
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>}
        </section>}

        {loading || scopePending ? <div className="rounded-2xl border border-violet-100 bg-white p-8 text-sm text-slate-500 shadow-sm">Loading staff and attendance…</div> : !memberships.length ? <div className="rounded-2xl border border-violet-100 bg-white p-8 text-sm text-slate-600 shadow-sm">Sign in and join an institute to view shared attendance.</div> : !staff.length ? <div className="rounded-2xl border border-violet-100 bg-white p-8 text-sm text-slate-600 shadow-sm">No active staff records are available for this branch. Add staff in Students &amp; Staff shared mode first.</div> : (
          <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-5">
            <aside className="h-fit rounded-2xl border border-violet-100 bg-white p-3 shadow-[0_8px_28px_rgba(30,41,59,0.05)] sm:p-4">
              <div className="mb-3 flex items-center gap-2 font-bold text-slate-800"><span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-100 text-violet-700"><Users size={16} /></span>Staff<span className="ml-auto rounded-full bg-violet-50 px-2 py-1 text-[11px] font-bold text-violet-700">{staff.length}</span></div>
              <div className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[550px] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
                {staff.map((person) => <button key={person.id} type="button" onClick={() => setSelectedStaffId(person.id)} className={`min-w-[145px] rounded-xl border px-3 py-2.5 text-left text-sm transition lg:min-w-0 ${selectedStaffId === person.id ? "border-violet-300 bg-gradient-to-r from-violet-50 to-fuchsia-50 font-semibold text-violet-900 shadow-sm" : "border-transparent bg-slate-50/80 text-slate-700 hover:border-violet-100 hover:bg-violet-50/60"}`}><span className="block truncate">{person.name}</span><span className="mt-0.5 block truncate text-xs font-normal text-slate-500">{person.designation || "Staff member"}</span></button>)}
              </div>
            </aside>

            <section className="min-w-0 space-y-3 sm:space-y-4">
              <div className="flex flex-col gap-3 rounded-2xl border border-violet-100 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-700"><CalendarDays size={19} /></span>
                  <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-violet-600">Attendance calendar</p><div className="mt-0.5 flex items-center gap-1"><button type="button" onClick={() => changeMonth(-1)} disabled={dirty.size > 0 || saving} aria-label="Previous month" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-violet-50 hover:text-violet-700 disabled:opacity-40"><ChevronLeft size={18} /></button><h2 className="min-w-0 text-base font-extrabold text-slate-900 sm:text-lg">{month ? new Date(year, monthNumber - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "Loading"}</h2><button type="button" onClick={() => changeMonth(1)} disabled={dirty.size > 0 || saving} aria-label="Next month" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-violet-50 hover:text-violet-700 disabled:opacity-40"><ChevronRight size={18} /></button></div></div>
                </div>
                <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700">P · Present</span><span className="rounded-full bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700">A · Absent</span><span className="rounded-full bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-700">L · Leave</span><button type="button" onClick={markAllPresent} disabled={!selectedStaff || !editableDates.length || saving} className="ml-auto rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50">Mark all present</button></div>
              </div>
              {selectedStaff && <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-violet-100 bg-white p-3 shadow-sm sm:p-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-sm font-extrabold text-white">{selectedStaff.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div><div className="min-w-0 flex-1"><h3 className="truncate font-bold text-slate-900">{selectedStaff.name}</h3><p className="text-xs text-slate-500">{selectedStaff.designation || "Staff member"}</p></div>{payable && <div className="rounded-xl bg-emerald-50 px-3 py-2 text-right"><p className="text-[10px] font-semibold text-emerald-700">Payroll payable</p><p className="font-extrabold text-emerald-800">{money(payable.amountCents / 100)}</p><p className="text-[10px] text-emerald-700/80">{payable.unpaidDays} unpaid days</p></div>}</div>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(["Present", "Absent", "Leave", "Holiday"] as const).map((status) => { const styles = status === "Present" ? "from-emerald-50 to-white text-emerald-700 ring-emerald-100" : status === "Absent" ? "from-rose-50 to-white text-rose-700 ring-rose-100" : status === "Leave" ? "from-amber-50 to-white text-amber-700 ring-amber-100" : "from-slate-100 to-white text-slate-700 ring-slate-200"; return <div key={status} className={`rounded-xl bg-gradient-to-br ${styles} p-3 ring-1`}><p className="text-[11px] font-semibold opacity-80">{status}</p><p className="mt-1 text-xl font-extrabold">{count(status)}</p></div>; })}</div>
              <div className="rounded-2xl border border-violet-100 bg-white p-2.5 shadow-[0_12px_35px_rgba(91,33,182,0.06)] sm:p-4">
                <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-extrabold uppercase tracking-wide text-slate-400 sm:mb-3 sm:gap-2 sm:text-xs">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="py-2">{day}</div>)}</div>
                <div className="grid grid-cols-7 gap-1 sm:gap-2">
                  {Array.from({ length: firstWeekday }, (_, index) => <div key={`blank-${index}`} />)}
                  {dates.map((date) => {
                    const day = Number(date.slice(-2));
                    const status = selectedStaff ? attendance[rowKey(selectedStaff.id, date)] : undefined;
                    const future = date > today;
                    const tone = status === "Present" ? "border-emerald-300 bg-gradient-to-b from-emerald-100 to-emerald-50" : status === "Absent" ? "border-rose-300 bg-gradient-to-b from-rose-100 to-rose-50" : status === "Leave" ? "border-amber-300 bg-gradient-to-b from-amber-100 to-amber-50" : status === "Holiday" ? "border-slate-300 bg-gradient-to-b from-slate-100 to-slate-50" : "border-slate-100 bg-white hover:border-violet-200 hover:bg-violet-50/60";
                    return <div key={date} className={`min-w-0 rounded-lg border p-0.5 transition sm:rounded-xl sm:p-1.5 ${tone} ${future ? "opacity-35" : "shadow-[0_2px_5px_rgba(15,23,42,0.03)]"}`}>
                      <div className="mb-0.5 text-center text-[10px] font-extrabold text-slate-700 sm:mb-1 sm:text-xs">{day}</div>
                      <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-4">{(["Present", "Absent", "Leave", "Holiday"] as const).map((value) => { const active = status === value; const buttonTone = active ? (value === "Present" ? "bg-emerald-600 text-white shadow-sm" : value === "Absent" ? "bg-rose-600 text-white shadow-sm" : value === "Leave" ? "bg-amber-500 text-white shadow-sm" : "bg-slate-600 text-white shadow-sm") : "text-slate-400 hover:bg-white hover:text-violet-700"; return <button key={value} type="button" title={`${value}${future ? " (future date)" : ""}`} aria-label={`${value} on ${date}`} aria-pressed={active} disabled={!selectedStaff || future || saving} onClick={() => setStatus(date, value)} className={`min-h-6 rounded-md px-0.5 py-1 text-[9px] font-extrabold transition sm:min-h-7 sm:rounded-lg sm:text-[10px] ${buttonTone} disabled:cursor-not-allowed disabled:opacity-35`}>{value === "Present" ? "P" : value === "Absent" ? "A" : value === "Leave" ? "L" : "H"}</button>; })}</div>
                    </div>;
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[10px] text-slate-500 sm:text-xs"><span>Tap P, A, L or H to mark a day.</span><span>{dirty.size ? <strong className="text-violet-700">{dirty.size} unsaved change{dirty.size === 1 ? "" : "s"}</strong> : "All changes saved"}</span></div>
              </div>
              <p className="px-1 text-[11px] leading-5 text-slate-500">Attendance saves by staff member and date. Mark a day Holiday to neutralize an existing mark; saved history is not deleted. Future dates follow the institute&apos;s time zone and are rejected by the database. Selecting a status scrolls back to the Save button so you can save your changes quickly.</p>
            </section>
          </div>
        )}

        {/* Bottom save action: draws attention only while there are unsaved edits. */}
        {staff.length > 0 && (
          <div
            ref={bottomSaveActionRef}
            className={`scroll-mt-6 rounded-2xl border p-3 shadow-lg transition-all duration-300 sm:p-4 ${
              dirty.size > 0
                ? "border-violet-300 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 shadow-violet-200/70"
                : "border-slate-200 bg-white shadow-slate-200/50"
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className={`text-sm font-extrabold ${dirty.size > 0 ? "text-violet-800" : "text-slate-800"}`}>
                  {dirty.size > 0 ? "Attendance changes not saved" : "Attendance is up to date"}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {dirty.size > 0
                    ? `${dirty.size} change${dirty.size === 1 ? "" : "s"} waiting to be saved to the shared database.`
                    : notice || "Any changes you make will appear here before saving."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void save()}
                disabled={loading || scopePending || saving || !dirty.size}
                className={`inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-extrabold text-white transition duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto ${
                  dirty.size > 0
                    ? "animate-pulse bg-gradient-to-r from-violet-700 via-purple-600 to-fuchsia-600 shadow-lg shadow-violet-300/60 hover:animate-none hover:brightness-105"
                    : "bg-slate-400 shadow-sm"
                }`}
              >
                <Save size={16} />
                {saving ? "Saving attendance…" : dirty.size > 0 ? `Save ${dirty.size} change${dirty.size === 1 ? "" : "s"}` : "All changes saved"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
