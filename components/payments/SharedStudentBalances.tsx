"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import StudentAvatar from "@/components/StudentAvatar";
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
  dateInTimeZone,
  groupStudentBalances,
  type BalanceReportInstallment,
  type BalanceReportStudent,
  type BalanceReportMode,
} from "@/lib/supabase/student-balance-report";

const PAGE_SIZE = 40;

const fieldClass =
  "w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100 sm:text-sm";

const money = (minor: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);

const displayDate = (value: string) => {
  if (!value) return "No due date";

  const date = new Date(`${value}T12:00:00`);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
      }).format(date);
};

type QueryPage<T> = {
  data: T[] | null;
  error: unknown | null;
  count: number | null;
};

async function readAllPages<T>(
  getPage: (
    from: number,
    to: number,
  ) => PromiseLike<QueryPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let offset = 0; offset < 100_000; offset += 1_000) {
    const { data, error, count } = await getPage(
      offset,
      offset + 999,
    );

    if (error) {
      throw new Error("Unable to load financial records.");
    }

    rows.push(...(data ?? []));

    if (
      !data?.length ||
      data.length < 1_000 ||
      (count !== null && rows.length >= count)
    ) {
      return rows;
    }
  }

  throw new Error(
    "Too many records. Select a branch to narrow the list.",
  );
}

export default function SharedStudentBalances({
  mode,
  onUseBrowser,
}: {
  mode: BalanceReportMode;
  onUseBrowser?: () => void;
}) {
  const workspaceScope = useWorkspaceScope();
  const projectAllowed = isAuthorizedTestProjectConfigured();

  const [institutes, setInstitutes] = useState<WorkspaceInstitute[]>([]);
  const [branches, setBranches] = useState<WorkspaceBranch[]>([]);

  const [instituteId, setInstituteId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");

  const [expandedStudents, setExpandedStudents] = useState<Set<string>>(
    new Set(),
  );

  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [branchesReload, setBranchesReload] = useState(0);

  const [scopeLoading, setScopeLoading] = useState(projectAllowed);
  const [scopeError, setScopeError] = useState("");
  const [lookupError, setLookupError] = useState("");

  const [dataResult, setDataResult] = useState<{
    key: string;
    students: BalanceReportStudent[];
    balances: BalanceReportInstallment[];
  } | null>(null);

  const [errorResult, setErrorResult] = useState<{
    key: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    void Promise.resolve().then(() => {
      if (!active) return;

      const selection = workspaceScope.selection;

      if (
        !selection ||
        !institutes.some((item) => item.id === selection.instituteId)
      ) {
        return;
      }

      setInstituteId(selection.instituteId);
      setBranchId(selection.branchId);
      setPage(0);
    });

    return () => {
      active = false;
    };
  }, [institutes, workspaceScope.selection]);

  const institute = institutes.find(
    (item) => item.id === instituteId,
  );

  const canViewRole =
    institute?.role === "owner" ||
    institute?.role === "administrator" ||
    institute?.role === "accountant";

  const canView =
    !!canViewRole &&
    (institute?.accessScope === "institute" || !!branchId);

  const scopePending =
    workspaceScope.loading ||
    (!!workspaceScope.selection &&
      institutes.some(
        (item) =>
          item.id === workspaceScope.selection?.instituteId,
      ) &&
      (instituteId !== workspaceScope.selection.instituteId ||
        branchId !== workspaceScope.selection.branchId));

  const queryKey = JSON.stringify([
    instituteId,
    branchId,
    reload,
  ]);

  const currentResult =
    !scopePending && dataResult?.key === queryKey
      ? dataResult
      : null;

  const currentError =
    errorResult?.key === queryKey
      ? errorResult.message
      : "";

  const loading =
    projectAllowed &&
    !!instituteId &&
    canView &&
    (scopePending || (!currentResult && !currentError));

  const businessDate = useMemo(() => {
    if (!institute) return "";

    try {
      return dateInTimeZone(new Date(), institute.timeZone);
    } catch {
      return "";
    }
  }, [institute]);

  const groups = useMemo(
    () =>
      groupStudentBalances(
        currentResult?.students ?? [],
        currentResult?.balances ?? [],
        mode,
        businessDate,
      ),
    [currentResult, mode, businessDate],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();

    if (!term) return groups;

    return groups.filter((group) =>
      [
        group.studentName,
        group.course,
        ...group.installments.map(
          (line) => `${line.number} ${line.dueDate}`,
        ),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(term),
    );
  }, [groups, search]);

  const pageCount = Math.max(
    1,
    Math.ceil(filtered.length / PAGE_SIZE),
  );

  const pageRows = filtered.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );

  const totalMinor = filtered.reduce(
    (sum, group) => sum + group.totalMinor,
    0,
  );

  const installmentCount = filtered.reduce(
    (sum, group) => sum + group.installments.length,
    0,
  );

  const toggleStudent = (studentId: string) => {
    setExpandedStudents((previous) => {
      const next = new Set(previous);

      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }

      return next;
    });
  };

  // Load institutes
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
        if (active) {
          setScopeError(
            "Institute access could not be verified. Sign in again or refresh.",
          );
        }
      })
      .finally(() => {
        if (active) setScopeLoading(false);
      });

    return () => {
      active = false;
    };
  }, [projectAllowed]);

  // Load accessible branches
  useEffect(() => {
    let active = true;

    if (!projectAllowed || !instituteId) return;

    void loadWorkspaceBranches(
      createSupabaseBrowserClient(),
      instituteId,
    )
      .then((rows) => {
        if (!active) return;

        setBranches(rows);
        setLookupError("");
      })
      .catch(() => {
        if (active) {
          setLookupError(
            "Accessible branches could not be loaded.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [branchesReload, instituteId, projectAllowed]);

  // Load authorized shared balances
  useEffect(() => {
    let active = true;

    if (
      !projectAllowed ||
      !instituteId ||
      !canView ||
      scopePending
    ) {
      return;
    }

    const supabase = createSupabaseBrowserClient();

    void (async () => {
      try {
        const nextStudents =
          await readAllPages<BalanceReportStudent>(
            (from, to) =>
              supabase
                .from("students")
                .select("id, name, course, archived_at", {
                  count: "exact",
                })
                .eq("institute_id", instituteId)
                .order("name")
                .range(from, to),
          );

        let query = supabase
          .from("installment_balances")
          .select(
            "installment_id, student_id, branch_id, sequence_number, scheduled_amount, paid_amount, outstanding_amount, due_date, scheduled_status",
            { count: "exact" },
          )
          .eq("institute_id", instituteId)
          .gt("outstanding_amount", 0)
          .neq("scheduled_status", "Cancelled")
          .order("due_date", {
            ascending: true,
            nullsFirst: false,
          })
          .order("sequence_number", {
            ascending: true,
          });

        if (branchId) {
          query = query.eq("branch_id", branchId);
        }

        const nextBalances =
          await readAllPages<BalanceReportInstallment>(
            (from, to) => query.range(from, to),
          );

        if (!active) return;

        setDataResult({
          key: queryKey,
          students: nextStudents,
          balances: nextBalances,
        });

        setErrorResult(null);
      } catch {
        if (active) {
          setErrorResult({
            key: queryKey,
            message:
              "Shared balances could not be loaded. Check database migrations and finance access, then retry.",
          });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [
    branchId,
    canView,
    instituteId,
    projectAllowed,
    queryKey,
    scopePending,
  ]);

  const title =
    mode === "overdue"
      ? "Overdue payments"
      : "Outstanding payments";

  const unitLabel =
    mode === "overdue" ? "overdue" : "outstanding";

  return (
    <WorkspaceLayout>
      <main className="min-h-screen w-full overflow-x-clip bg-[#fffdf6] px-2 py-2 sm:px-4 sm:py-3 lg:px-6">
        <div className="mx-auto w-full max-w-7xl min-w-0 space-y-2.5 sm:space-y-3">

          {/* Slim yellow header */}
          <header className="relative isolate overflow-hidden rounded-xl border border-amber-200 bg-gradient-to-r from-[#fff0a6] to-[#ffd43b] px-3 py-2 shadow-sm sm:px-4 sm:py-2.5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-7 -top-10 size-24 rounded-full border-[9px] border-white/40 sm:size-28"
            />

            <div className="relative flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-900">
                  <span
                    className={`size-1.5 rounded-full ${
                      mode === "overdue"
                        ? "bg-rose-600"
                        : "bg-emerald-600"
                    }`}
                  />
                  BIZBOOK · ACCOUNTS
                </span>

                <h1 className="mt-0.5 text-sm font-extrabold leading-tight text-slate-900 sm:text-base">
                  {title}
                </h1>

                <p className="mt-0.5 hidden text-[10px] text-slate-600 sm:block sm:text-xs">
                  {mode === "overdue"
                    ? "Payments past their due date."
                    : "Student balances across upcoming and past-due installments."}
                </p>
              </div>

              <div className="relative shrink-0 rounded-lg border border-white/70 bg-white/65 px-2.5 py-1.5">
                <p className="text-[8px] font-bold uppercase tracking-wide text-slate-500">
                  Payment status
                </p>

                <p
                  className={`text-xs font-extrabold sm:text-sm ${
                    mode === "overdue"
                      ? "text-rose-700"
                      : "text-slate-900"
                  }`}
                >
                  {mode === "overdue" ? "Past due" : "Outstanding"}
                </p>
              </div>
            </div>

            <div className="relative mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-1.5 border-t border-amber-900/10 pt-1.5 text-[9px] text-slate-600 sm:text-[10px]">
              <span className="min-w-0 truncate">
                Workspace:{" "}
                <strong className="text-slate-900">
                  {institute?.name ?? "Institute account"}
                </strong>
              </span>

              <span className="shrink-0 rounded-full bg-white/50 px-2 py-0.5">
                Shared institute ledger
              </span>
            </div>
          </header>

          {!projectAllowed ? (
            <div
              role="alert"
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"
            >
              Shared financial records are enabled only for the authorized HTTPS test project.
            </div>
          ) : scopeLoading ? (
            <div
              role="status"
              className="rounded-xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-500"
            >
              Checking institute access…
            </div>
          ) : scopeError ? (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800"
            >
              {scopeError}
            </div>
          ) : institutes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
              <h2 className="text-sm font-bold text-slate-800">
                No institute access
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Sign in with an authorized institute account.
              </p>
            </div>
          ) : (
            <section className="min-w-0 space-y-2.5 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:space-y-3 sm:p-4">

              {/* Search and refresh */}
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {institutes.length > 1 && (
                  <label className="col-span-2 grid min-w-0 gap-1 text-[10px] font-semibold text-slate-600 sm:col-span-1 sm:text-xs">
                    Institute

                    <select
                      className={fieldClass}
                      value={instituteId}
                      onChange={(event) => {
                        const next = event.target.value;

                        setInstituteId(next);
                        setBranchId("");
                        setPage(0);

                        void workspaceScope.selectInstitute(next);
                      }}
                    >
                      {institutes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {institute?.accessScope === "branches" &&
                  branches.length > 1 && (
                    <label className="col-span-2 grid min-w-0 gap-1 text-[10px] font-semibold text-slate-600 sm:col-span-1 sm:text-xs">
                      Branch

                      <select
                        className={fieldClass}
                        value={branchId}
                        onChange={(event) => {
                          const next = event.target.value;

                          setBranchId(next);
                          setPage(0);
                          workspaceScope.selectBranch(next);
                        }}
                      >
                        <option value="" disabled>
                          Select branch
                        </option>

                        {branches.map((item: WorkspaceBranch) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                <label className="col-span-1 grid min-w-0 gap-1 text-[10px] font-semibold text-slate-600 sm:text-xs">
                  Search student

                  <input
                    className={fieldClass}
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(0);
                    }}
                    placeholder="Name or course"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setReload((value) => value + 1)}
                  disabled={loading}
                  className="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#facc15] px-3 py-2 text-[11px] font-bold text-slate-900 transition hover:bg-[#eab308] focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-9 sm:px-4 sm:text-xs"
                >
                  <RefreshCw
                    size={13}
                    className={loading ? "animate-spin" : ""}
                  />

                  {loading ? "Loading" : "Refresh"}
                </button>
              </div>

              {!canViewRole ? (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                >
                  Balance reports require owner, administrator, or accountant access.
                </div>
              ) : institute?.accessScope === "branches" &&
                !branchId ? (
                <p
                  role="status"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                >
                  Choose an assigned branch to view balances.
                </p>
              ) : lookupError || currentError ? (
                <div
                  role="alert"
                  className="flex min-w-0 items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
                >
                  <AlertCircle
                    size={15}
                    className="mt-0.5 shrink-0"
                  />

                  <span className="min-w-0 flex-1 break-words">
                    {lookupError || currentError}
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      setLookupError("");
                      setBranchesReload((value) => value + 1);
                      setReload((value) => value + 1);
                    }}
                    className="shrink-0 font-semibold underline"
                  >
                    Retry
                  </button>
                </div>
              ) : loading ? (
                <div
                  role="status"
                  className="rounded-lg bg-slate-50 p-5 text-center text-xs text-slate-500"
                >
                  Loading shared balances…
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center">
                  <h2 className="text-sm font-bold text-slate-800">
                    No {unitLabel} installments
                  </h2>

                  <p className="mt-1 text-xs text-slate-500">
                    No matching outstanding balances were found.
                  </p>
                </div>
              ) : (
                <>
                  {/* Small summary cards */}
                  <div
                    className={`grid min-w-0 grid-cols-3 gap-1.5 rounded-lg border p-1.5 sm:gap-2 sm:p-2 ${
                      mode === "overdue"
                        ? "border-rose-100 bg-rose-50"
                        : "border-amber-100 bg-[#fff9df]"
                    }`}
                  >
                    {/* Total outstanding */}
                    <div className="min-w-0 rounded-md border border-slate-100 bg-white px-1.5 py-2 shadow-sm sm:rounded-lg sm:px-3 sm:py-2.5">
                      <p className="text-[7px] font-bold uppercase leading-tight tracking-wide text-slate-500 sm:text-[10px]">
                        Total Outstanding
                      </p>

                      <p
                        className={`mt-1 break-all text-[13px] font-black leading-tight tracking-tight sm:break-words sm:text-xl ${
                          mode === "overdue"
                            ? "text-rose-700"
                            : "text-[#a16207]"
                        }`}
                      >
                        {money(totalMinor)}
                      </p>

                      <p className="mt-0.5 text-[7px] leading-tight text-slate-500 sm:text-[10px]">
                        Remaining to collect
                      </p>
                    </div>

                    {/* Student count */}
                    <div className="min-w-0 rounded-md border border-slate-100 bg-white px-1.5 py-2 shadow-sm sm:rounded-lg sm:px-3 sm:py-2.5">
                      <p className="text-[7px] font-bold uppercase leading-tight tracking-wide text-slate-500 sm:text-[10px]">
                        Students
                      </p>

                      <p className="mt-1 text-base font-black leading-tight text-slate-900 sm:text-xl">
                        {filtered.length}
                      </p>

                      <p className="mt-0.5 text-[7px] leading-tight text-slate-500 sm:text-[10px]">
                        With balance
                      </p>
                    </div>

                    {/* Installment count */}
                    <div className="min-w-0 rounded-md border border-slate-100 bg-white px-1.5 py-2 shadow-sm sm:rounded-lg sm:px-3 sm:py-2.5">
                      <p className="text-[7px] font-bold uppercase leading-tight tracking-wide text-slate-500 sm:text-[10px]">
                        Installments
                      </p>

                      <p className="mt-1 text-base font-black leading-tight text-slate-900 sm:text-xl">
                        {installmentCount}
                      </p>

                      <p className="mt-0.5 text-[7px] leading-tight text-slate-500 sm:text-[10px]">
                        Page {page + 1} of {pageCount}
                      </p>
                    </div>
                  </div>

                  {/* Mobile student cards */}
                  <div className="grid min-w-0 gap-1.5 md:hidden">
                    {pageRows.map((group) => {
                      const expanded = expandedStudents.has(
                        group.studentId,
                      );

                      return (
                        <article
                          key={group.studentId}
                          className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white"
                        >
                          <div className="flex min-w-0 items-center gap-2 p-2">
                            <StudentAvatar
                              studentId={group.studentId}
                              name={group.studentName}
                              size={30}
                              className="shrink-0"
                            />

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-bold text-slate-900">
                                {group.studentName}
                              </p>

                              <p className="truncate text-[9px] text-slate-500">
                                {group.course}
                                {group.archived
                                  ? " · Archived"
                                  : ""}
                              </p>

                              <p
                                className={`mt-0.5 text-xs font-extrabold ${
                                  mode === "overdue"
                                    ? "text-rose-700"
                                    : "text-[#a16207]"
                                }`}
                              >
                                {money(group.totalMinor)}
                                <span className="ml-1 text-[8px] font-medium text-slate-500">
                                  due
                                </span>
                              </p>
                            </div>

                            <button
                              type="button"
                              aria-expanded={expanded}
                              onClick={() =>
                                toggleStudent(group.studentId)
                              }
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-200 bg-[#fff9df] px-2 py-1.5 text-[9px] font-bold text-amber-900 transition hover:bg-amber-100"
                            >
                              {expanded ? "Hide" : "Installments"}

                              <ChevronDown
                                size={11}
                                className={`transition-transform ${
                                  expanded ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                          </div>

                          {expanded && (
                            <div className="space-y-1.5 border-t border-amber-100 bg-[#fffdf5] p-2">
                              {group.installments.map((line) => (
                                <div
                                  key={line.id}
                                  className="min-w-0 rounded-md border border-slate-100 bg-white p-2"
                                >
                                  <div className="flex min-w-0 items-start justify-between gap-2">
                                    <p className="min-w-0 text-[10px] font-bold text-slate-800">
                                      {line.number === 0
                                        ? "Admission fee"
                                        : `Installment #${line.number}`}
                                    </p>

                                    <p className="shrink-0 text-[10px] font-extrabold text-amber-800">
                                      {money(line.outstandingMinor)}
                                    </p>
                                  </div>

                                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[9px] text-slate-500">
                                    <span className="min-w-0 break-words">
                                      Due: {displayDate(line.dueDate)}
                                    </span>

                                    <span className="min-w-0 break-words text-right">
                                      Scheduled: {money(line.scheduledMinor)}
                                    </span>

                                    <span className="min-w-0 break-words">
                                      Paid: {money(line.paidMinor)}
                                    </span>

                                    {mode === "overdue" && (
                                      <span className="text-right text-rose-700">
                                        {line.daysOverdue} days overdue
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden min-w-0 overflow-hidden rounded-lg border border-slate-200 md:block">
                    <table className="w-full table-fixed text-left text-xs">
                      <thead
                        className={
                          mode === "overdue"
                            ? "bg-rose-50 text-slate-600"
                            : "bg-[#fff9df] text-slate-600"
                        }
                      >
                        <tr>
                          <th className="w-[23%] px-2.5 py-2.5 font-bold">
                            Student
                          </th>

                          <th className="w-[20%] px-2 py-2.5 font-bold">
                            Installments
                          </th>

                          <th className="w-[17%] px-2 py-2.5 font-bold">
                            Due date
                          </th>

                          <th className="w-[13%] px-2 py-2.5 text-right font-bold">
                            Scheduled
                          </th>

                          <th className="w-[12%] px-2 py-2.5 text-right font-bold">
                            Paid
                          </th>

                          <th className="w-[15%] px-2 py-2.5 text-right font-bold">
                            Outstanding
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {pageRows.map((group) => {
                          const expanded = expandedStudents.has(
                            group.studentId,
                          );

                          return (
                            <tr
                              key={group.studentId}
                              className="bg-white align-top hover:bg-amber-50/40"
                            >
                              <td className="px-2.5 py-2.5">
                                <div className="flex min-w-0 items-center gap-2">
                                  <StudentAvatar
                                    studentId={group.studentId}
                                    name={group.studentName}
                                    size={30}
                                    className="shrink-0"
                                  />

                                  <div className="min-w-0">
                                    <p className="truncate font-bold text-slate-900">
                                      {group.studentName}
                                    </p>

                                    <p className="truncate text-[10px] text-slate-500">
                                      {group.course}
                                      {group.archived
                                        ? " · Archived"
                                        : ""}
                                    </p>

                                    <p className="mt-0.5 text-[10px] font-bold text-amber-800">
                                      {money(group.totalMinor)}
                                    </p>
                                  </div>
                                </div>
                              </td>

                              <td className="px-2 py-2.5">
                                <button
                                  type="button"
                                  aria-expanded={expanded}
                                  onClick={() =>
                                    toggleStudent(group.studentId)
                                  }
                                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-amber-200 bg-[#fff9df] px-2 py-1.5 text-[10px] font-bold text-amber-900 hover:bg-amber-100"
                                >
                                  <span className="truncate">
                                    {expanded
                                      ? "Hide details"
                                      : `View ${group.installments.length} installments`}
                                  </span>

                                  <ChevronDown
                                    size={12}
                                    className={`shrink-0 transition-transform ${
                                      expanded ? "rotate-180" : ""
                                    }`}
                                  />
                                </button>
                              </td>

                              <td className="px-2 py-2.5 text-slate-500">
                                {group.installments.length === 1
                                  ? displayDate(
                                      group.installments[0].dueDate,
                                    )
                                  : `${group.installments.length} due dates`}
                              </td>

                              <td className="break-words px-2 py-2.5 text-right text-slate-600">
                                {money(
                                  group.installments.reduce(
                                    (sum, line) =>
                                      sum + line.scheduledMinor,
                                    0,
                                  ),
                                )}
                              </td>

                              <td className="break-words px-2 py-2.5 text-right text-slate-600">
                                {money(
                                  group.installments.reduce(
                                    (sum, line) =>
                                      sum + line.paidMinor,
                                    0,
                                  ),
                                )}
                              </td>

                              <td className="break-words px-2 py-2.5 text-right font-extrabold text-amber-800">
                                {money(group.totalMinor)}
                              </td>
                            </tr>
                          );
                        })}

                        {pageRows.map((group) =>
                          expandedStudents.has(group.studentId) ? (
                            <tr key={`${group.studentId}-details`}>
                              <td colSpan={6} className="p-0">
                                <div className="space-y-1.5 bg-[#fffdf5] p-2.5">
                                  {group.installments.map((line) => (
                                    <div
                                      key={line.id}
                                      className="grid grid-cols-5 items-center gap-2 rounded-md border border-amber-100 bg-white px-3 py-2 text-[10px]"
                                    >
                                      <span className="font-semibold text-slate-800">
                                        {line.number === 0
                                          ? "Admission fee"
                                          : `Installment #${line.number}`}
                                      </span>

                                      <span className="text-slate-500">
                                        Due: {displayDate(line.dueDate)}
                                      </span>

                                      <span className="text-slate-600">
                                        Scheduled: {money(line.scheduledMinor)}
                                      </span>

                                      <span className="text-slate-600">
                                        Paid: {money(line.paidMinor)}
                                      </span>

                                      <span className="text-right font-bold text-amber-800">
                                        Balance: {money(line.outstandingMinor)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ) : null,
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Compact pagination */}
                  <div className="flex min-w-0 items-center justify-between gap-2 pt-0.5">
                    <p className="min-w-0 text-[9px] text-slate-500 sm:text-[11px]">
                      {page * PAGE_SIZE + 1}–
                      {Math.min(
                        (page + 1) * PAGE_SIZE,
                        filtered.length,
                      )}{" "}
                      of {filtered.length} students
                    </p>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={page === 0 || loading}
                        onClick={() =>
                          setPage((value) => Math.max(0, value - 1))
                        }
                        className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 px-2 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-amber-50 disabled:opacity-40 sm:text-xs"
                      >
                        <ChevronLeft size={13} />
                        Previous
                      </button>

                      <button
                        type="button"
                        disabled={page + 1 >= pageCount || loading}
                        onClick={() => setPage((value) => value + 1)}
                        className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 px-2 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-amber-50 disabled:opacity-40 sm:text-xs"
                      >
                        Next
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </main>
    </WorkspaceLayout>
  );
}