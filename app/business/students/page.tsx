
"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  GraduationCap,
  UserRound,
  Plus,
  Search,
  Pencil,
  Trash2,
  CircleX,
  X,
  Wallet,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Save,
  BriefcaseBusiness,
  Calculator,
  CreditCard,
  Download,
  Eye,
} from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import StudentAvatar from "@/components/StudentAvatar";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";
import type { Json } from "@/lib/supabase/database.types";
import { toCsv } from "@/lib/csv";
import { isAuthorizedTestProjectConfigured } from "@/lib/supabase/workspace-scope";
import {
  mapSharedStudent,
  toStudentRecordInput,
  type SharedStudent,
  type SharedStudentRow,
  type StudentReceiptBalanceRow,
} from "@/lib/supabase/student-records";

type Installment = {
  id: string;
  amount: number;
  dueDate: string;
  status: "Pending" | "Paid" | "Partially Paid";
  paidAmount?: number;
  outstandingAmount?: number;
  legacyData?: Record<string, unknown>;
};

type Student = {
  id: string;
  name: string;
  gender: "Male" | "Female" | "Other";
  parentName: string;
  parentEmail?: string;
  parentEmailOptIn?: boolean;
  whatsappOptIn?: boolean;
  emailReceiptOptIn?: boolean;
  whatsappReceiptOptIn?: boolean;
  parentMobile: string;
  whatsapp: string;
  course: string;
  admissionDate: string;
  admissionFee: number;
  admissionInstallmentId?: string | null;
  admissionPaidAmount?: number;
  admissionOutstandingAmount?: number;
  admissionStatus?: "Pending" | "Paid" | "Partially Paid" | "Overdue";
  totalFee: number;
  installments: Installment[];
  instituteId?: string;
  branchId?: string | null;
  className?: string;
  collectedAmount?: number;
  [key: string]: unknown;
};

type Staff = {
  id: string;
  branchId?: string | null;
  name: string;
  gender: "Male" | "Female" | "Other";
  mobile: string;
  whatsapp: string;
  designation: string;
  joiningDate: string;
  monthlySalary: number;
  paymentDate: number;
  unpaidLeaveDays: number;
  deductionPerDay: number;
  paidAmount: number;
  salaryStatus: "Pending" | "Paid";
  manualPayableAmount?: number;
  attendanceEnabled?: boolean;
  salaryCalculationMode?: "AttendanceBased" | "Fixed";
};

type Tab = "students" | "staff";
type StudentStorageMode = "browser" | "shared";
type Membership = {
  instituteId: string;
  instituteName: string;
  role: "owner" | "administrator" | "accountant" | "staff";
  accessScope: "institute" | "branches";
};
type BranchOption = { id: string; name: string };
type PlanLimitNotice = {
  resource: "student" | "staff";
  used: number;
  limit: number;
};

function parsePlanLimitError(message: string | undefined): PlanLimitNotice | null {
  if (!message) return null;
  const match = /^PLAN_LIMIT_REACHED\|(students|staff)\|(\d+)\|(\d+)$/.exec(message);
  if (!match) return null;
  return {
    resource: match[1] === "students" ? "student" : "staff",
    used: Number(match[2]),
    limit: Number(match[3]),
  };
}

function PlanLimitNoticeCard({ notice }: { notice: PlanLimitNotice }) {
  const label = notice.resource === "student" ? "active students" : "active staff records";
  const title = notice.resource === "student" ? "Student limit reached" : "Staff limit reached";

  return (
    <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-950 shadow-sm">
      <div className="flex items-start gap-3">
        <CircleX size={19} className="mt-0.5 shrink-0 text-rose-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{title}</p>
          <p className="mt-1 text-sm leading-5">
            Your institute uses <strong>{notice.used} of {notice.limit}</strong> allowed {label} on its current plan.
            The new record was not saved. Existing records remain unchanged.
          </p>
          <p className="mt-1 text-xs leading-5 text-rose-800">
            Archived records do not count. A plan change is charged at the full selected billing price without automatic proration or credit; checkout shows the amount before you confirm payment.
          </p>
          <Link href="/settings/subscription" className="mt-3 inline-flex min-h-9 items-center justify-center rounded-lg bg-rose-700 px-3.5 text-xs font-bold text-white transition hover:bg-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2">
            View plans and upgrade
          </Link>
        </div>
      </div>
    </div>
  );
}

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
);
const authorizedTestProjectConfigured = isAuthorizedTestProjectConfigured();

async function readAllPages<T>(
  getPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
    count: number | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset <= 100_000; offset += 1_000) {
    const { data, error, count } = await getPage(offset, offset + 999);
    if (error) throw new Error("A shared student query could not be completed.");
    rows.push(...(data ?? []));
    if (!data?.length || data.length < 1_000 || (count !== null && rows.length >= count)) return rows;
  }
  throw new Error("This institute has more than 100,000 matching records; narrow the branch filter before loading.");
}

const inputClass =
  "w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-50";

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50";

const money = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);


const makeId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const emptyStudent = () => ({
  name: "",
  gender: "Male" as "Male" | "Female" | "Other",
  parentName: "",
  parentEmail: "",
  parentEmailOptIn: false,
  whatsappOptIn: false,
  emailReceiptOptIn: false,
  whatsappReceiptOptIn: false,
  parentMobile: "",
  whatsapp: "",
  course: "",
  // Keep date fields empty during the initial render to avoid a
  // server/client hydration mismatch. They are filled in after mount.
  admissionDate: "",
  admissionFee: "0",
  totalFee: "",
  installmentMode: "automatic" as "automatic" | "manual",
  installmentCount: "6",
  firstDueDate: "",
  manualInstallments: [{ amount: "", dueDate: "", installmentId: undefined as string | undefined, locked: false }],
});

const emptyStaff = () => ({
  name: "",
  gender: "Other" as "Male" | "Female" | "Other",
  mobile: "",
  whatsapp: "",
  designation: "",
  joiningDate: "",
  monthlySalary: "",
  paymentDate: "1",
  unpaidLeaveDays: "0",
  deductionPerDay: "",
  paidAmount: "",
  salaryStatus: "Pending" as "Pending" | "Paid",
  // The payable amount is recalculated from attendance/leave deductions,
  // but remains editable by the user before saving.
  manualPayableAmount: "",
  attendanceEnabled: true,
});

function dueStatus(installment: Installment, currentDate: string) {
  if (installment.status === "Paid") return "Paid";
  if (!currentDate || !installment.dueDate) return "Pending";
  if (installment.dueDate < currentDate) return "Overdue";
  if (installment.dueDate === currentDate) return "Due today";
  return "Pending";
}

function hasRecordedInstallmentPayment(installment: Installment) {
  return installment.status === "Paid"
    || installment.status === "Partially Paid"
    || (Number(installment.paidAmount) || 0) > 0;
}

function hasRecordedAdmissionPayment(student: Student | undefined) {
  return Boolean(student && (
    student.admissionStatus === "Paid"
    || student.admissionStatus === "Partially Paid"
    || (Number(student.admissionPaidAmount) || 0) > 0
  ));
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Paid: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    Pending: "border border-amber-200 bg-amber-50 text-amber-700",
    Overdue: "border border-rose-200 bg-rose-50 text-rose-700",
    "Due today": "border border-violet-200 bg-violet-50 text-violet-700",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ${styles[status] ?? "bg-slate-100 text-slate-600"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === "Paid" ? "bg-emerald-500" : status === "Pending" ? "bg-amber-500" : status === "Due today" ? "bg-violet-500" : status === "Overdue" ? "bg-rose-500" : "bg-slate-400"}`} />
      {status}
    </span>
  );
}

function MetricCard({
  icon,
  label,
  value,
  description,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
  color: "blue" | "green" | "red" | "orange";
}) {
  const colors = {
    blue: {
      card: "border-violet-200/80 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50/60",
      icon: "bg-violet-100 text-violet-700 ring-violet-200",
      label: "text-violet-800",
      value: "from-violet-700 to-fuchsia-600",
      description: "text-violet-700/75",
      accent: "from-violet-500 to-fuchsia-500",
    },
    green: {
      card: "border-emerald-200/80 bg-gradient-to-r from-emerald-50 via-white to-teal-50/70",
      icon: "bg-emerald-100 text-emerald-700 ring-emerald-200",
      label: "text-emerald-800",
      value: "from-emerald-700 to-teal-600",
      description: "text-emerald-700/75",
      accent: "from-emerald-500 to-teal-500",
    },
    red: {
      card: "border-rose-200/80 bg-gradient-to-r from-rose-50 via-white to-pink-50/70",
      icon: "bg-rose-100 text-rose-700 ring-rose-200",
      label: "text-rose-800",
      value: "from-rose-700 to-pink-600",
      description: "text-rose-700/75",
      accent: "from-rose-500 to-pink-500",
    },
    orange: {
      card: "border-amber-200/80 bg-gradient-to-r from-amber-50 via-white to-orange-50/70",
      icon: "bg-amber-100 text-orange-700 ring-amber-200",
      label: "text-amber-900",
      value: "from-amber-700 to-orange-600",
      description: "text-orange-800/75",
      accent: "from-amber-400 to-orange-500",
    },
  };
  const theme = colors[color];

  return (
    <div className={`group relative flex min-w-0 items-start gap-3 overflow-hidden rounded-2xl border ${theme.card} px-3.5 py-3.5 shadow-[0_5px_18px_rgba(91,33,182,0.07)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(91,33,182,0.13)] sm:px-4 sm:py-4`}>
      <div className={`absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-gradient-to-b ${theme.accent}`} />
      <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset shadow-sm ${theme.icon}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className={`text-[13px] font-extrabold tracking-[-0.01em] ${theme.label}`}>{label}</p>
          <p className={`bg-gradient-to-r ${theme.value} bg-clip-text text-xl font-black leading-tight tracking-[-0.045em] text-transparent sm:text-2xl`}>
            {value}
          </p>
        </div>
        <p className={`mt-1.5 text-[11px] leading-[1.55] sm:text-xs ${theme.description}`}>
          {description}
        </p>
      </div>
      <div className={`pointer-events-none absolute -bottom-8 -right-6 h-16 w-16 rounded-full bg-gradient-to-br ${theme.accent} opacity-[0.07] blur-sm transition-opacity group-hover:opacity-[0.12]`} />
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-[#7C3AED]">
        {icon}
      </div>
      <div>
        <h2 className="text-sm font-bold text-slate-900 sm:text-base">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

export default function StudentsStaffPage() {
  return (
    <Suspense fallback={<WorkspaceLayout><main className="mx-auto max-w-7xl p-4"><div role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading student workspace…</div></main></WorkspaceLayout>}>
      <StudentsStaffContent />
    </Suspense>
  );
}

function StudentsStaffContent() {
  const searchParams = useSearchParams();
  const admissionCancellationWorkflow = searchParams.get("workflow") === "cancel-admission";
  const workspaceScope = useWorkspaceScope();
  const setWorkspaceBlocker = workspaceScope.setBlocker;
  const [tab, setTab] = useState<Tab>("students");
  const [localStudents, setLocalStudents] = useState<Student[]>([]);
  const [sharedStudents, setSharedStudents] = useState<Student[]>([]);
  const [storageMode] = useState<StudentStorageMode>("shared");
  const students = storageMode === "shared" ? sharedStudents : localStudents;
  const setStudents = storageMode === "shared" ? setSharedStudents : setLocalStudents;
  const [localStaff, setLocalStaff] = useState<Staff[]>([]);
  const [sharedStaff, setSharedStaff] = useState<Staff[]>([]);
  const staff = storageMode === "shared" ? sharedStaff : localStaff;
  const setStaff = storageMode === "shared" ? setSharedStaff : setLocalStaff;
  const [loaded, setLoaded] = useState(false);
  const [todayDate, setTodayDate] = useState("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [selectedInstituteId, setSelectedInstituteId] = useState("");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("all");
  const [studentBranchId, setStudentBranchId] = useState("");
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedSaving, setSharedSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [studentStatusFilter, setStudentStatusFilter] = useState("All");
  const [staffStatusFilter, setStaffStatusFilter] = useState("All");

  const [studentModal, setStudentModal] = useState(false);
  const [staffModal, setStaffModal] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);

  const [studentForm, setStudentForm] = useState(emptyStudent());
  const [staffForm, setStaffForm] = useState(emptyStaff());
  const [staffBranchId, setStaffBranchId] = useState("");
  const [error, setError] = useState("");
  const [planLimitNotice, setPlanLimitNotice] = useState<PlanLimitNotice | null>(null);
  const [notice, setNotice] = useState("");

  const [detailStudent, setDetailStudent] = useState<Student | null>(null);
  const [cancellingStudent, setCancellingStudent] = useState<Student | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [detailStaff, setDetailStaff] = useState<Staff | null>(null);
  const [installmentEdit, setInstallmentEdit] = useState<{ studentId: string; installmentId: string; amount: string; minAmount: number; maxAmount: number } | null>(null);

  useEffect(() => {
    if (!admissionCancellationWorkflow) return;
    const timer = window.setTimeout(() => {
      setTab("students");
      setSearch("");
      window.requestAnimationFrame(() => {
        document.getElementById("student-records")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [admissionCancellationWorkflow]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const date = new Date();
      const currentDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      setTodayDate(currentDate);
      setStudentForm((form) => ({
        ...form,
        admissionDate: form.admissionDate || currentDate,
        firstDueDate: form.firstDueDate || currentDate,
        manualInstallments: form.manualInstallments.map((item) => ({
          ...item,
          dueDate: item.dueDate || currentDate,
        })),
      }));
      setStaffForm((form) => ({
        ...form,
        joiningDate: form.joiningDate || currentDate,
      }));
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!authorizedTestProjectConfigured) return;
    let active = true;
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) return;
        const { data: rows, error: membershipError } = await supabase
          .from("user_memberships")
          .select("institute_id, role, access_scope")
          .eq("user_id", authData.user.id)
          .eq("is_active", true);
        if (membershipError) throw new Error("Could not load institute access.");
        const instituteIds = (rows ?? []).map((row) => row.institute_id);
        if (!instituteIds.length) {
          if (active) setMemberships([]);
          return;
        }
        const { data: institutes, error: instituteError } = await supabase
          .from("coaching_institutes")
          .select("id, business_name")
          .in("id", instituteIds);
        if (instituteError) throw new Error("Could not load institute details.");
        const names = new Map((institutes ?? []).map((institute) => [institute.id, institute.business_name]));
        const available = (rows ?? []).flatMap((membership) => {
          const instituteName = names.get(membership.institute_id);
          return instituteName ? [{
            instituteId: membership.institute_id,
            instituteName,
            role: membership.role,
            accessScope: membership.access_scope,
          }] : [];
        });
        if (!active) return;
        setMemberships(available);
        setSelectedInstituteId((current) => available.some((item) => item.instituteId === current)
          ? current
          : available[0]?.instituteId ?? "");
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load institute access.");
      }
    })();
    return () => { active = false; };
  }, []);

  const selectedMembership = memberships.find((membership) => membership.instituteId === selectedInstituteId);
  const canManageSharedStudents = !!selectedMembership &&
    (selectedMembership.role === "owner" || selectedMembership.role === "administrator");
  const canViewSharedFinance = !!selectedMembership &&
    ["owner", "administrator", "accountant"].includes(selectedMembership.role);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const next = workspaceScope.selection;
      if (!next || !memberships.some((item) => item.instituteId === next.instituteId)) return;
      setSelectedInstituteId(next.instituteId);
      setSelectedBranchId(next.branchId || "all");
      setDetailStudent(null);
      setDetailStaff(null);
      setSearch("");
    });
    return () => { active = false; };
  }, [memberships, workspaceScope.selection]);

  useEffect(() => {
    const hasUnsavedWork = storageMode === "shared" && (studentModal || staffModal || !!installmentEdit || sharedSaving);
    setWorkspaceBlocker(hasUnsavedWork ? "Finish or close the unsaved student, staff, or installment form before switching institute or branch." : "");
    return () => setWorkspaceBlocker("");
  }, [installmentEdit, sharedSaving, staffModal, storageMode, studentModal, setWorkspaceBlocker]);

  useEffect(() => {
    if (!authorizedTestProjectConfigured || !selectedInstituteId) {
      void Promise.resolve().then(() => setBranches([]));
      return;
    }
    let active = true;
    void (async () => {
      const { data, error: branchError } = await createSupabaseBrowserClient()
        .from("branches")
        .select("id, name")
        .eq("institute_id", selectedInstituteId)
        .eq("is_active", true)
        .order("name");
      if (!active) return;
      if (branchError) {
        setError("Could not load branches for this institute.");
        setBranches([]);
        return;
      }
      const available = data ?? [];
      setBranches(available);
      if (selectedMembership?.accessScope === "branches") {
        setSelectedBranchId((current) => available.some((branch) => branch.id === current)
          ? current
          : available[0]?.id ?? "");
      } else {
        setSelectedBranchId((current) => current === "all" || available.some((branch) => branch.id === current)
          ? current
          : "all");
      }
    })();
    return () => { active = false; };
  }, [selectedInstituteId, selectedMembership?.accessScope]);

  const loadSharedStudents = useCallback(async (instituteId: string, branchId: string) => {
    const supabase = createSupabaseBrowserClient();
    const [studentRows, balances] = await Promise.all([
      readAllPages((from, to) => {
        let query = supabase.from("students")
          .select("id, institute_id, branch_id, name, gender, parent_name, parent_email, parent_email_opt_in, whatsapp_opt_in, email_receipt_opt_in, whatsapp_receipt_opt_in, parent_mobile, whatsapp, course, class_name, admission_date, total_fee, admission_fee, legacy_data", { count: "exact" })
          .eq("institute_id", instituteId)
          .is("archived_at", null)
          .order("name");
        if (branchId !== "all") query = query.eq("branch_id", branchId);
        return query.range(from, to);
      }),
      readAllPages((from, to) => {
        let query = supabase.from("installment_balances")
          .select("installment_id, institute_id, branch_id, student_id, sequence_number, scheduled_amount, due_date, scheduled_status, paid_amount, outstanding_amount, balance_status, legacy_data", { count: "exact" })
          .eq("institute_id", instituteId)
          .order("sequence_number");
        if (branchId !== "all") query = query.eq("branch_id", branchId);
        return query.range(from, to);
      }),
    ]);
    const collectedByStudent = new Map<string, number>();
    if (canViewSharedFinance) {
      const receiptBalances = await readAllPages((from, to) => {
        let query = supabase.from("student_receipt_balances")
          .select("institute_id, branch_id, student_id, receipt_count, receipt_total, completed_refund_total, net_receipts", { count: "exact" })
          .eq("institute_id", instituteId);
        if (branchId !== "all") query = query.eq("branch_id", branchId);
        return query.range(from, to);
      });
      for (const receipt of receiptBalances as StudentReceiptBalanceRow[]) {
        collectedByStudent.set(receipt.student_id, Number(receipt.net_receipts));
      }
    }
    const mapped = (studentRows as SharedStudentRow[])
      .map((row) => ({ ...mapSharedStudent(row, balances), collectedAmount: Math.max(0, collectedByStudent.get(row.id) ?? 0) })) as Student[];
    setSharedStudents(mapped);
    return mapped;
  }, [canViewSharedFinance]);

  const loadSharedStaff = useCallback(async (instituteId: string, branchId: string) => {
    if (!todayDate) return [];
    const supabase = createSupabaseBrowserClient();
    const payrollMonth = todayDate.slice(0, 7);
    const [yearText, monthText] = payrollMonth.split("-");
    const nextMonth = new Date(Date.UTC(Number(yearText), Number(monthText), 1)).toISOString().slice(0, 10);
    const staffRows = await readAllPages((from, to) => {
      let query = supabase.from("staff")
        .select("id, institute_id, branch_id, name, gender, mobile, whatsapp, designation, joining_date, salary_calculation_mode, attendance_enabled", { count: "exact" })
        .eq("institute_id", instituteId)
        .is("archived_at", null)
        .order("name")
        .order("id");
      if (branchId !== "all") query = query.eq("branch_id", branchId);
      return query.range(from, to);
    });
    const compensationRows = canViewSharedFinance
      ? await supabase.rpc("list_staff_compensation", {
          p_institute_id: instituteId,
          p_branch_id: branchId === "all" ? null : branchId,
        }).then(({ data, error }) => {
          if (error) throw new Error("Could not load finance-authorized staff salary settings.");
          return data ?? [];
        })
      : [];
    const [attendanceRows, salaryRows] = await Promise.all([
      readAllPages((from, to) => {
        let query = supabase.from("attendance_records")
          .select("staff_id, status", { count: "exact" })
          .eq("institute_id", instituteId)
          .gte("attendance_date", `${payrollMonth}-01`)
          .lt("attendance_date", nextMonth)
          .in("status", ["Absent", "Leave"]);
        if (branchId !== "all") query = query.eq("branch_id", branchId);
        return query.range(from, to);
      }),
      canViewSharedFinance ? readAllPages((from, to) => {
        let query = supabase.from("salary_payments")
          .select("staff_id, amount", { count: "exact" })
          .eq("institute_id", instituteId)
          .eq("payroll_month", payrollMonth);
        if (branchId !== "all") query = query.eq("branch_id", branchId);
        return query.range(from, to);
      }) : Promise.resolve([]),
    ]);
    const unpaidDays = new Map<string, number>();
    for (const row of attendanceRows) unpaidDays.set(row.staff_id, (unpaidDays.get(row.staff_id) ?? 0) + 1);
    const payments = new Map(salaryRows.map((row) => [row.staff_id, Number(row.amount)]));
    const compensation = new Map(compensationRows.map((row) => [row.id, row]));
    const mapped = staffRows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      name: row.name,
      gender: row.gender ?? "Other",
      mobile: row.mobile ?? "",
      whatsapp: row.whatsapp ?? row.mobile ?? "",
      designation: row.designation ?? "",
      joiningDate: row.joining_date ?? "",
      monthlySalary: Number(compensation.get(row.id)?.monthly_salary ?? 0),
      paymentDate: Number(compensation.get(row.id)?.payment_day ?? 1),
      unpaidLeaveDays: unpaidDays.get(row.id) ?? 0,
      deductionPerDay: Number(compensation.get(row.id)?.per_day_leave_cut ?? 0),
      paidAmount: payments.get(row.id) ?? 0,
      salaryStatus: payments.has(row.id) ? "Paid" as const : "Pending" as const,
      manualPayableAmount: compensation.get(row.id)?.manual_payable_amount == null ? undefined : Number(compensation.get(row.id)?.manual_payable_amount),
      attendanceEnabled: row.attendance_enabled,
      salaryCalculationMode: row.salary_calculation_mode,
    } satisfies Staff));
    setSharedStaff(mapped);
    return mapped;
  }, [canViewSharedFinance, todayDate]);

  useEffect(() => {
    if (storageMode !== "shared" || !selectedInstituteId || !selectedMembership) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return null;
      setSharedLoading(true);
      setError("");
      return Promise.all([
        loadSharedStudents(selectedInstituteId, selectedBranchId),
        loadSharedStaff(selectedInstituteId, selectedBranchId),
      ]);
    })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load shared students.");
      })
      .finally(() => { if (active) setSharedLoading(false); });
    return () => { active = false; };
  }, [storageMode, selectedInstituteId, selectedBranchId, selectedMembership, loadSharedStudents, loadSharedStaff]);

  const persistSharedStudent = useCallback(async (
    student: Student,
    branchId: string | null,
  ): Promise<Student | null> => {
    if (!selectedInstituteId) {
      setError("Choose an institute before saving a student.");
      return null;
    }
    if (selectedMembership?.accessScope === "branches" && !branchId) {
      setError("Choose one of your permitted branches before saving this student.");
      return null;
    }
    setSharedSaving(true);
    setError("");
    setPlanLimitNotice(null);
    try {
      const sharedStudent = {
        ...student,
        instituteId: selectedInstituteId,
        branchId,
        className: typeof student.className === "string" ? student.className : "",
        installments: student.installments.filter((item) => Number(item.amount) > 0),
      } as SharedStudent;
      const input = toStudentRecordInput(sharedStudent);
      const { data, error: saveError } = await createSupabaseBrowserClient().rpc("save_student_record", {
        p_institute_id: selectedInstituteId,
        p_branch_id: branchId,
        p_student_id: student.id,
        p_student: input.student as Json,
        p_installments: input.installments as Json,
      });
      if (saveError || data !== student.id) {
        const limitNotice = saveError?.code === "23514" ? parsePlanLimitError(saveError.message) : null;
        const validationMessage = saveError?.message?.toLowerCase() ?? "";
        if (limitNotice) {
          setPlanLimitNotice(limitNotice);
          setError("");
        } else if (validationMessage.includes("installment") && (validationMessage.includes("recorded payment") || validationMessage.includes("paid amount"))) {
          setError("An installment with a recorded payment is locked. Only installments with no payments can have their amount or due date changed.");
        } else if (validationMessage.includes("online checkout") && validationMessage.includes("installment")) {
          setError("This installment has an active online checkout or payment link. Resolve that checkout before changing its amount or due date.");
        } else {
          setError(saveError?.code === "42501"
            ? "Your role or branch access does not allow student changes."
            : saveError?.code === "23514"
              ? "The student details did not pass a database validation rule. Review the form and try again."
              : "Could not save the shared student. Confirm the student-record migration is applied.");
        }
        return null;
      }
      const { error: receiptConsentError } = await createSupabaseBrowserClient()
        .from("students")
        .update({
          whatsapp_receipt_opt_in: sharedStudent.whatsappReceiptOptIn === true,
          email_receipt_opt_in: sharedStudent.emailReceiptOptIn === true,
        })
        .eq("id", student.id)
        .eq("institute_id", selectedInstituteId);
      if (receiptConsentError) {
        setError("The student was saved, but receipt delivery consent could not be updated. Open the student again and retry the consent settings.");
        return null;
      }
      const refreshed = await loadSharedStudents(selectedInstituteId, selectedBranchId);
      return refreshed.find((item) => item.id === student.id) ?? sharedStudent as Student;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the shared student.");
      return null;
    } finally {
      setSharedSaving(false);
    }
  }, [loadSharedStudents, selectedBranchId, selectedInstituteId, selectedMembership?.accessScope]);

  const studentStats = useMemo(() => {
    const totalFee = students.reduce((sum, s) => sum + s.totalFee, 0);
    const collected = storageMode === "shared"
      ? students.reduce((sum, student) => sum + (Number(student.collectedAmount) || 0), 0)
      : students.reduce(
          (sum, s) =>
            sum +
            (Number(s.admissionFee) || 0) +
            s.installments
              .filter((i) => i.status === "Paid")
              .reduce((total, i) => total + i.amount, 0),
          0
        );

    const pending = storageMode === "shared"
      ? students.reduce((sum, student) => sum + (Number(student.admissionOutstandingAmount) || 0) + student.installments.reduce((total, installment) => total + (Number(installment.outstandingAmount) || 0), 0), 0)
      : students.reduce(
          (sum, s) =>
            sum +
            s.installments
              .filter((i) => i.status !== "Paid")
              .reduce((total, i) => total + i.amount, 0),
          0
        );

    const overdue = students.reduce(
      (sum, s) =>
        sum + (storageMode === "shared" && s.admissionStatus === "Overdue" ? Number(s.admissionOutstandingAmount) || 0 : 0) +
        s.installments
          .filter((i) => dueStatus(i, todayDate) === "Overdue")
          .reduce((total, i) => total + (storageMode === "shared" ? Number(i.outstandingAmount) || 0 : i.amount), 0),
      0
    );

    return { totalFee, collected, pending, overdue };
  }, [students, todayDate, storageMode]);

  const staffStats = useMemo(() => {
    const salaryObligation = staff.reduce(
      (sum, person) => sum + Math.max(
        0,
        (person.manualPayableAmount ?? (person.monthlySalary -
          (person.attendanceEnabled === false ? 0 : person.unpaidLeaveDays * person.deductionPerDay)))
      ),
      0
    );

    const paid = staff.reduce(
      (sum, person) => sum + person.paidAmount,
      0
    );

    return {
      count: staff.length,
      salaryObligation,
      paid,
      pending: Math.max(0, salaryObligation - paid),
    };
  }, [staff]);

  const filteredStudents = students.filter((student) => {
    const query = search.toLowerCase();

    const matchesSearch =
      student.name.toLowerCase().includes(query) ||
      student.course.toLowerCase().includes(query) ||
      student.parentMobile.includes(search) ||
      student.whatsapp.includes(search);

    const pendingAmount = student.installments
      .filter((item) => item.status !== "Paid")
      .reduce((sum, item) => sum + item.amount, 0);

    const overdueAmount = student.installments
      .filter((item) => dueStatus(item, todayDate) === "Overdue")
      .reduce((sum, item) => sum + (storageMode === "shared" ? Number(item.outstandingAmount) || 0 : item.amount), 0) +
      (storageMode === "shared" && student.admissionStatus === "Overdue" ? Number(student.admissionOutstandingAmount) || 0 : 0);

    const status = storageMode === "shared"
      ? (Number(student.collectedAmount) || 0) >= student.totalFee
        ? "Paid"
        : overdueAmount > 0
          ? "Overdue"
          : "Pending"
      : pendingAmount === 0
        ? "Paid"
        : overdueAmount > 0
          ? "Overdue"
          : "Pending";

    return (
      matchesSearch &&
      (studentStatusFilter === "All" || studentStatusFilter === status)
    );
  });

  const filteredStaff = staff.filter((person) => {
    const matchesSearch =
      person.name.toLowerCase().includes(search.toLowerCase()) ||
      person.designation.toLowerCase().includes(search.toLowerCase()) ||
      person.mobile.includes(search);

    const netSalary = Math.max(
      0,
      (person.manualPayableAmount ?? (person.monthlySalary -
        (person.attendanceEnabled === false ? 0 : person.unpaidLeaveDays * person.deductionPerDay)))
    );

    const status =
      person.paidAmount >= netSalary && netSalary > 0
        ? "Paid"
        : "Pending";

    return (
      matchesSearch &&
      (staffStatusFilter === "All" || staffStatusFilter === status)
    );
  });

  function downloadStudentsCsv() {
    const headers = [
      "Student ID", "Student Name", "Gender", "Parent/Guardian Name", "Course/Class", "Parent Mobile",
      "WhatsApp", "Admission Date", "Admission Fee", "Total Course Fee",
      "Paid Total", "Outstanding", "Pending Installments", "Overdue Installments",
      "Installment Schedule"
    ];
    const rows = students.map((student) => {
      const paidInstallments = student.installments.filter((i) => i.status === "Paid");
      const pendingInstallments = student.installments.filter((i) => i.status !== "Paid");
      const paid = (Number(student.admissionFee) || 0) + paidInstallments.reduce((sum, i) => sum + i.amount, 0);
      const outstanding = pendingInstallments.reduce((sum, i) => sum + i.amount, 0);
      const pendingSummary = pendingInstallments.map((item) => {
        const index = student.installments.findIndex((i) => i.id === item.id) + 1;
        return `#${index}: ${money(item.amount)} due ${item.dueDate} (${dueStatus(item, todayDate)})`;
      }).join(" | ");
      const overdueSummary = pendingInstallments
        .map((item) => ({ item, index: student.installments.findIndex((i) => i.id === item.id) + 1 }))
        .filter(({ item }) => dueStatus(item, todayDate) === "Overdue")
        .map(({ item, index }) => `#${index}: ${money(item.amount)} due ${item.dueDate}`)
        .join(" | ");
      const schedule = student.installments.map((item, index) =>
        `#${index + 1} ${money(item.amount)} due ${item.dueDate} [${dueStatus(item, todayDate)}]`
      ).join(" | ");
      return [
        student.id, student.name, student.gender ?? "Other", student.parentName,
        student.course, student.parentMobile, student.whatsapp, student.admissionDate,
        String(student.admissionFee ?? 0), String(student.totalFee), String(paid),
        String(outstanding), pendingSummary, overdueSummary, schedule
      ];
    });
    const csv = toCsv(headers, rows);
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `students-fee-records-${todayDate || "export"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function openAddStudent() {
    setEditingStudentId(null);
    setStudentBranchId(selectedBranchId === "all" ? "" : selectedBranchId);
    setStudentForm({ ...emptyStudent(), admissionDate: todayDate, firstDueDate: todayDate, manualInstallments: [{ amount: "", dueDate: todayDate, installmentId: undefined, locked: false }] });
    setError("");
    setPlanLimitNotice(null);
    setStudentModal(true);
  }

  function openEditStudent(student: Student) {
    setEditingStudentId(student.id);
    setStudentBranchId(student.branchId ?? "");

    setStudentForm({
      name: student.name,
      gender: student.gender ?? "Other",
      parentName: student.parentName ?? "",
      parentEmail: student.parentEmail ?? "",
      parentEmailOptIn: student.parentEmailOptIn === true,
      whatsappOptIn: student.whatsappOptIn === true,
      emailReceiptOptIn: student.emailReceiptOptIn === true,
      whatsappReceiptOptIn: student.whatsappReceiptOptIn === true,
      parentMobile: student.parentMobile,
      whatsapp: student.whatsapp,
      course: student.course,
      admissionDate: student.admissionDate,
      admissionFee: String(student.admissionFee ?? 0),
      totalFee: String(student.totalFee),
      installmentMode: "manual",
      installmentCount: String(student.installments.length || 1),
      firstDueDate: student.installments[0]?.dueDate || todayDate,
      manualInstallments:
        student.installments.length > 0
          ? student.installments.map((item) => ({
              amount: String(item.amount),
              dueDate: item.dueDate,
              installmentId: item.id,
              locked: hasRecordedInstallmentPayment(item),
            }))
          : [{ amount: "", dueDate: todayDate, installmentId: undefined, locked: false }],
    });

    setError("");
    setPlanLimitNotice(null);
    setStudentModal(true);
  }

  async function saveStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPlanLimitNotice(null);

    const name = studentForm.name.trim();
    const parentName = studentForm.parentName.trim();
    const parentEmail = studentForm.parentEmail.trim();
    const parentMobile = studentForm.parentMobile.trim();
    const whatsapp = studentForm.whatsapp.trim();
    const course = studentForm.course.trim();
    const totalFeePaise = parseAmountInputToPaise(studentForm.totalFee);
    const admissionFeePaise = parseAmountInputToPaise(studentForm.admissionFee.trim() || "0");
    const totalFee = totalFeePaise === null ? Number.NaN : totalFeePaise / 100;
    const admissionFee = admissionFeePaise === null ? Number.NaN : admissionFeePaise / 100;

    if (!name || !parentName || !course) {
      setError("Student name, parent/guardian name and course are required.");
      return;
    }

    if (!/^\d{10}$/.test(parentMobile)) {
      setError("Enter a valid 10-digit parent mobile number.");
      return;
    }

    if (!/^\d{10}$/.test(whatsapp)) {
      setError("Enter a valid 10-digit WhatsApp number.");
      return;
    }
    if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
      setError("Enter a valid parent/guardian email address or leave it blank.");
      return;
    }

    if (totalFeePaise === null || totalFeePaise <= 0) {
      setError("Enter a valid total course fee greater than zero, with no more than two decimal places.");
      return;
    }

    if (admissionFeePaise === null || admissionFeePaise > totalFeePaise) {
      setError("Admission fee must be between ₹0 and the total course fee.");
      return;
    }

    if (storageMode === "shared" && selectedMembership?.accessScope === "branches" && !studentBranchId) {
      setError("Choose one of your permitted branches for this student.");
      return;
    }

    let installments: Installment[] = [];

    if (studentForm.installmentMode === "automatic") {
      const count = Number(studentForm.installmentCount);

      if (!Number.isInteger(count) || count < 1 || count > 60) {
        setError("Choose between 1 and 60 installments.");
        return;
      }

      if (!studentForm.firstDueDate) {
        setError("Choose the first installment due date.");
        return;
      }

      const installmentBalancePaise = totalFeePaise - admissionFeePaise;
      let remaining = installmentBalancePaise;

      installments = Array.from({ length: count }, (_, index) => {
        const amountInPaise =
          index === count - 1
            ? remaining
            : Math.floor(installmentBalancePaise / count);

        remaining -= amountInPaise;

        const date = new Date(`${studentForm.firstDueDate}T12:00:00`);
        date.setMonth(date.getMonth() + index);

        return {
          id: makeId(),
          amount: amountInPaise / 100,
          dueDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
          status: "Pending" as const,
        };
      });
    } else {
      const manual = studentForm.manualInstallments;

      if (manual.length === 0) {
        setError("Add at least one installment.");
        return;
      }

      const manualInstallmentPaise = manual.map((item) => parseAmountInputToPaise(item.amount));
      if (manualInstallmentPaise.some((amount) => amount === null) || manual.some((item) => !item.dueDate)) {
        setError("Enter each installment amount to the nearest paise and choose a due date.");
        return;
      }
      const validManualInstallmentPaise = manualInstallmentPaise.filter((amount): amount is number => amount !== null);

      const previousInstallments = editingStudentId
        ? students.find((s) => s.id === editingStudentId)?.installments ?? []
        : [];

      installments = manual.map((item, index) => {
        const previous = item.installmentId
          ? previousInstallments.find((installment) => installment.id === item.installmentId)
          : undefined;
        const lockedPrevious = previous && hasRecordedInstallmentPayment(previous) ? previous : undefined;
        const amountPaise = validManualInstallmentPaise[index] ?? 0;
        const amount = lockedPrevious ? lockedPrevious.amount : amountPaise / 100;
        const dueDate = lockedPrevious ? lockedPrevious.dueDate : item.dueDate;
        const paidAmount = Math.max(0, Number(previous?.paidAmount) || 0);
        const sameTerms = previous && previous.amount === amount && previous.dueDate === dueDate;

        return {
          ...(previous ?? {}),
          id: previous?.id ?? makeId(),
          amount,
          dueDate,
          status: storageMode === "shared"
            ? amount > 0 && paidAmount >= amount
              ? "Paid" as const
              : paidAmount > 0
                ? "Partially Paid" as const
                : "Pending" as const
            : sameTerms
              ? previous.status
              : "Pending" as const,
          ...(storageMode === "shared" ? {
            paidAmount,
            outstandingAmount: Math.max(0, Math.round((amount - paidAmount) * 100) / 100),
          } : {}),
        };
      });

      const sumPaise = validManualInstallmentPaise.reduce((total, amount) => total + amount, 0);
      const remainingPaise = totalFeePaise - admissionFeePaise;

      if (sumPaise !== remainingPaise) {
        setError(
          `Installments total ${money(sumPaise / 100)}. They must equal the remaining fee ${money(remainingPaise / 100)} after admission fee.`
        );
        return;
      }
    }

    const previousStudent = editingStudentId
      ? students.find((item) => item.id === editingStudentId)
      : undefined;
    const student: Student = {
      ...(previousStudent ?? {}),
      id: editingStudentId ?? makeId(),
      name,
      gender: studentForm.gender,
      parentName,
      parentEmail,
      parentEmailOptIn: studentForm.parentEmailOptIn,
      whatsappOptIn: studentForm.whatsappOptIn,
      emailReceiptOptIn: studentForm.emailReceiptOptIn,
      whatsappReceiptOptIn: studentForm.whatsappReceiptOptIn,
      parentMobile,
      whatsapp,
      course,
      admissionDate: studentForm.admissionDate,
      admissionFee,
      totalFee,
      installments,
    };

    if (storageMode === "shared") {
      const saved = await persistSharedStudent(student, studentBranchId || null);
      if (!saved) return;
      setStudentModal(false);
      setDetailStudent(saved);
      setNotice(editingStudentId ? "Student updated in the shared institute database." : "Student added to the shared institute database.");
      return;
    }

    setStudents((previous) =>
      editingStudentId
        ? previous.map((item) =>
            item.id === editingStudentId ? student : item
          )
        : [student, ...previous]
    );

    setStudentModal(false);
    setNotice(editingStudentId ? "Student updated." : "Student added.");
  }

  async function deleteStudent(student: Student) {
    const sharedArchive = storageMode === "shared";
    const prompt = sharedArchive
      ? `Archive student "${student.name}"? Payment, installment, refund and audit history will remain available.`
      : `Delete student "${student.name}" and their fee schedule?`;
    if (!window.confirm(prompt)) {
      return;
    }

    if (sharedArchive) {
      if (!canManageSharedStudents || !selectedInstituteId) {
        setError("Only an institute owner or administrator can archive shared students.");
        return;
      }
      setSharedSaving(true);
      setError("");
      const { error: archiveError } = await createSupabaseBrowserClient().rpc("archive_student_record", {
        p_institute_id: selectedInstituteId,
        p_student_id: student.id,
      });
      setSharedSaving(false);
      if (archiveError) {
        setError(archiveError.code === "42501"
          ? "Your role or branch access does not allow archiving this student."
          : "Could not archive this student. Confirm the student-record migration is applied.");
        return;
      }
      await loadSharedStudents(selectedInstituteId, selectedBranchId);
      setDetailStudent(null);
      setNotice("Student archived. Payment and installment history was retained.");
      return;
    }

    setStudents((previous) =>
      previous.filter((item) => item.id !== student.id)
    );
    setDetailStudent(null);
    setNotice("Student deleted.");
  }

  async function cancelAdmission() {
    if (!cancellingStudent || !selectedInstituteId || !canManageSharedStudents) return;
    const reason = cancellationReason.trim();
    if (reason.length < 5 || reason.length > 500) {
      setError("Enter a cancellation reason between 5 and 500 characters.");
      return;
    }
    setSharedSaving(true);
    setError("");
    const { error: cancellationError } = await createSupabaseBrowserClient().rpc("cancel_student_admission", {
      p_institute_id: selectedInstituteId,
      p_student_id: cancellingStudent.id,
      p_reason: reason,
    });
    setSharedSaving(false);
    if (cancellationError) {
      setError(cancellationError.code === "42501"
        ? "Your role or branch access does not allow cancelling this admission."
        : cancellationError.code === "55P03"
          ? "An online payment is still pending. Reconcile or cancel it before cancelling admission."
          : cancellationError.message.includes("different reason")
            ? "This admission was already cancelled with a different recorded reason."
            : cancellationError.code === "22023"
              ? cancellationError.message
              : "Could not cancel this admission. Refresh and retry, or ask an administrator to check the database status.");
      return;
    }
    await loadSharedStudents(selectedInstituteId, selectedBranchId);
    setDetailStudent(null);
    setCancellingStudent(null);
    setCancellationReason("");
    setNotice("Admission cancelled. Fees, receipts, allocations, refunds, and balances were retained; no refund or fee waiver was issued.");
  }

  function editInstallmentAmount(studentId: string, installmentId: string) {
    const student = students.find((item) => item.id === studentId);
    if (!student) return;
    const installment = student.installments.find((item) => item.id === installmentId);
    if (!installment || hasRecordedInstallmentPayment(installment)) {
      setNotice("Installments with any recorded payment are locked. Only fully unpaid installments can be edited.");
      return;
    }
    const protectedPaise = student.installments
      .filter(hasRecordedInstallmentPayment)
      .reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
    const editablePoolPaise = Math.max(
      0,
      Math.round((student.totalFee - (student.admissionFee ?? 0)) * 100) - protectedPaise
    );
    const otherEditable = student.installments.filter((item) => !hasRecordedInstallmentPayment(item) && item.id !== installmentId);
    const minAmount = 0.01;
    const maxAmount = Math.max(minAmount, (editablePoolPaise - otherEditable.length) / 100);
    setInstallmentEdit({
      studentId,
      installmentId,
      amount: String(Math.max(minAmount, Math.min(installment.amount, maxAmount))),
      minAmount,
      maxAmount,
    });
  }

  async function saveInstallmentAmount() {
    if (!installmentEdit) return;
    const { studentId, installmentId, minAmount, maxAmount } = installmentEdit;
    const student = students.find((item) => item.id === studentId);
    if (!student) return;
    const amountPaise = parseAmountInputToPaise(installmentEdit.amount);
    if (amountPaise === null) {
      setNotice("Enter an amount with no more than two decimal places.");
      return;
    }
    const amount = amountPaise / 100;
    if (amount < minAmount || amount > maxAmount) {
      setNotice(`Enter an amount between ₹0 and ${money(maxAmount)}.`);
      return;
    }
    const protectedPaise = student.installments
      .filter(hasRecordedInstallmentPayment)
      .reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
    const editablePoolPaise = Math.max(
      0,
      Math.round((student.totalFee - (student.admissionFee ?? 0)) * 100) - protectedPaise
    );
    const otherPending = student.installments.filter((item) => !hasRecordedInstallmentPayment(item) && item.id !== installmentId);
    if (otherPending.length === 0 && amountPaise !== editablePoolPaise) {
      setNotice(`This is the last unpaid installment, so it must equal ${money(maxAmount)}.`);
      return;
    }
    const remainingPaise = editablePoolPaise - amountPaise;
    const otherMinimums = otherPending.map(() => 1);
    const minimumTotal = otherMinimums.reduce((sum, value) => sum + value, 0);
    if (remainingPaise < minimumTotal) {
      setNotice("The remaining schedule must leave at least ₹0.01 for every other unpaid installment.");
      return;
    }
    const each = otherPending.length ? Math.floor((remainingPaise - minimumTotal) / otherPending.length) : 0;
    let left = remainingPaise - minimumTotal;
    const updatedInstallments = student.installments.map((item) => {
      if (item.id === installmentId) return { ...item, amount };
      if (hasRecordedInstallmentPayment(item)) return item;
      const index = otherPending.findIndex((pending) => pending.id === item.id);
      if (index < 0) return item;
      const extraPaise = index === otherPending.length - 1 ? left : each;
      const nextPaise = otherMinimums[index] + extraPaise;
      left -= extraPaise;
      return { ...item, amount: nextPaise / 100 };
    });
    const updatedStudent = { ...student, installments: updatedInstallments };
    if (storageMode === "shared") {
      const saved = await persistSharedStudent(updatedStudent, student.branchId ?? null);
      if (!saved) return;
      setDetailStudent(saved);
      setInstallmentEdit(null);
      setNotice("Installment schedule updated. Invoice balances and future reminders now use the revised unpaid amounts; recorded payments remain attached.");
      return;
    }
    setStudents((previous) => previous.map((item) => item.id === studentId ? updatedStudent : item));
    setDetailStudent(updatedStudent);
    setInstallmentEdit(null);
    setNotice("Installment updated. Remaining unpaid installments were adjusted automatically.");
  }


  function openAddStaff() {
    setEditingStaffId(null);
    setStaffForm({ ...emptyStaff(), joiningDate: todayDate });
    setStaffBranchId(selectedBranchId === "all" ? "" : selectedBranchId);
    setError("");
    setPlanLimitNotice(null);
    setStaffModal(true);
  }

  function openEditStaff(person: Staff) {
    setEditingStaffId(person.id);
    setStaffBranchId(person.branchId ?? "");
    setStaffForm({
      name: person.name,
      gender: person.gender ?? "Other",
      mobile: person.mobile ?? "",
      whatsapp: person.whatsapp ?? person.mobile ?? "",
      designation: person.designation,
      joiningDate: person.joiningDate,
      monthlySalary: String(person.monthlySalary),
      paymentDate: String(person.paymentDate),
      unpaidLeaveDays: String(person.unpaidLeaveDays),
      deductionPerDay: String(person.deductionPerDay),
      paidAmount: String(person.paidAmount),
      salaryStatus: person.salaryStatus,
      manualPayableAmount: person.manualPayableAmount == null ? "" : String(person.manualPayableAmount),
      attendanceEnabled: person.attendanceEnabled ?? true,
    });
    setError("");
    setPlanLimitNotice(null);
    setStaffModal(true);
  }

  async function saveStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPlanLimitNotice(null);

    const name = staffForm.name.trim();
    const designation = staffForm.designation.trim();
    const mobile = staffForm.mobile.trim();
    const whatsapp = staffForm.whatsapp.trim();
    const paymentDate = Number(staffForm.paymentDate);
    const monthlySalaryPaise = parseAmountInputToPaise(staffForm.monthlySalary);
    const unpaidLeaveDays = Number(
      editingStaffId
        ? (staff.find((item) => item.id === editingStaffId)?.unpaidLeaveDays ?? 0)
        : 0
    );
    const deductionPerDayPaise = parseAmountInputToPaise(staffForm.deductionPerDay.trim() || "0");
    const paidAmountPaise = parseAmountInputToPaise(staffForm.paidAmount.trim() || "0");
    const hasManualPayable = staffForm.manualPayableAmount.trim() !== "";
    const manualPayablePaise = hasManualPayable
      ? parseAmountInputToPaise(staffForm.manualPayableAmount)
      : null;
    const calculatedPayablePaise = monthlySalaryPaise === null || deductionPerDayPaise === null
      ? null
      : staffForm.attendanceEnabled
        ? Math.max(0, monthlySalaryPaise - unpaidLeaveDays * deductionPerDayPaise)
        : monthlySalaryPaise;
    const netSalaryPaise = hasManualPayable ? manualPayablePaise : calculatedPayablePaise;
    const monthlySalary = monthlySalaryPaise === null ? Number.NaN : monthlySalaryPaise / 100;
    const deductionPerDay = deductionPerDayPaise === null ? Number.NaN : deductionPerDayPaise / 100;
    const paidAmount = paidAmountPaise === null ? Number.NaN : paidAmountPaise / 100;
    const netSalary = netSalaryPaise === null ? Number.NaN : netSalaryPaise / 100;

    if (!name || !designation) {
      setError("Staff name and designation are required.");
      return;
    }

    if (!/^\d{10}$/.test(mobile)) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }

    if (!/^\d{10}$/.test(whatsapp)) {
      setError("Enter a valid 10-digit WhatsApp number.");
      return;
    }

    if (!Number.isInteger(paymentDate) || paymentDate < 1 || paymentDate > 31) {
      setError("Salary payment date must be between 1 and 31.");
      return;
    }

    if (monthlySalaryPaise === null) {
      setError("Enter a valid monthly salary with no more than two decimal places.");
      return;
    }

    if (deductionPerDayPaise === null) {
      setError("Enter a valid per-day deduction with no more than two decimal places.");
      return;
    }

    if (hasManualPayable && manualPayablePaise === null) {
      setError("Enter a valid manual payable amount with no more than two decimal places.");
      return;
    }

    if (netSalaryPaise === null || !Number.isFinite(netSalary) || netSalary < 0) {
      setError("Enter a valid salary payable amount.");
      return;
    }

    if (paidAmountPaise === null || paidAmountPaise > (netSalaryPaise ?? 0)) {
      setError(`Amount paid must be between ₹0 and ${money(netSalary)}.`);
      return;
    }

    const person: Staff = {
      id: editingStaffId ?? makeId(),
      name,
      gender: staffForm.gender,
      mobile,
      whatsapp,
      designation,
      joiningDate: staffForm.joiningDate,
      monthlySalary,
      paymentDate,
      unpaidLeaveDays,
      deductionPerDay,
      paidAmount,
      salaryStatus: (paidAmountPaise ?? 0) >= (netSalaryPaise ?? 0) && netSalary > 0
        ? "Paid"
        : staffForm.salaryStatus,
      manualPayableAmount: hasManualPayable ? (manualPayablePaise ?? 0) / 100 : undefined,
      attendanceEnabled: staffForm.attendanceEnabled,
    };

    if (storageMode === "shared") {
      if (!selectedMembership || !selectedInstituteId) {
        setError("Choose an institute before saving staff.");
        return;
      }
      if (!canManageSharedStudents) {
        setError("Only an institute owner or administrator can change shared staff records.");
        return;
      }
      const existingStaff = editingStaffId ? staff.find((item) => item.id === editingStaffId) : undefined;
      const branchId = existingStaff?.branchId ?? (editingStaffId ? null : staffBranchId || null);
      if (selectedMembership.accessScope === "branches" && !branchId) {
        setError("Choose a permitted branch before saving this staff member.");
        return;
      }
      setSharedSaving(true);
      setError("");
      try {
        const supabase = createSupabaseBrowserClient();
        const values = {
          branch_id: branchId,
          name: person.name,
          gender: person.gender,
          mobile: person.mobile,
          whatsapp: person.whatsapp,
          designation: person.designation,
          joining_date: person.joiningDate || null,
          monthly_salary: person.monthlySalary,
          payment_day: person.paymentDate,
          per_day_leave_cut: person.deductionPerDay,
          manual_payable_amount: staffForm.manualPayableAmount.trim() ? netSalary : null,
          salary_calculation_mode: person.attendanceEnabled ? "AttendanceBased" as const : "Fixed" as const,
          attendance_enabled: person.attendanceEnabled ?? true,
        };
        const result = editingStaffId
          ? await supabase.from("staff").update(values).eq("institute_id", selectedInstituteId).eq("id", editingStaffId).is("archived_at", null).select("id").maybeSingle()
          : await supabase.from("staff").insert({
              id: person.id,
              institute_id: selectedInstituteId,
              ...values,
              legacy_data: {},
            }).select("id").maybeSingle();
        if (result.error || !result.data) {
          const limitNotice = result.error?.code === "23514" ? parsePlanLimitError(result.error.message) : null;
          if (limitNotice) {
            setPlanLimitNotice(limitNotice);
            setError("");
          } else {
            setError(result.error?.code === "42501"
              ? "Your role or branch access does not allow this staff change."
              : result.error?.code === "23514"
                ? "The staff details did not pass a database validation rule. Review the form and try again."
                : "Could not save the shared staff record. Reload and retry; existing data was not overwritten.");
          }
          return;
        }
        await loadSharedStaff(selectedInstituteId, selectedBranchId);
        setStaffModal(false);
        setNotice(editingStaffId ? "Shared staff record updated." : "Staff member added to the shared institute database.");
      } catch {
        setError("Could not save the shared staff record. Check the connection and reload before retrying.");
      } finally {
        setSharedSaving(false);
      }
      return;
    }

    setStaff((previous) =>
      editingStaffId
        ? previous.map((item) =>
            item.id === editingStaffId ? person : item
          )
        : [person, ...previous]
    );

    setStaffModal(false);
    setNotice(editingStaffId ? "Staff record updated." : "Staff member added.");
  }

  async function deleteStaff(person: Staff) {
    if (!window.confirm(`Delete staff member "${person.name}"?`)) {
      return;
    }

    if (storageMode === "shared") {
      if (!selectedMembership || !selectedInstituteId || !canManageSharedStudents) {
        setError("Only an institute owner or administrator can archive shared staff records.");
        return;
      }
      setSharedSaving(true);
      setError("");
      try {
        const { data, error: archiveError } = await createSupabaseBrowserClient()
          .from("staff")
          .update({ archived_at: new Date().toISOString() })
          .eq("institute_id", selectedInstituteId)
          .eq("id", person.id)
          .is("archived_at", null)
          .select("id")
          .maybeSingle();
        if (archiveError || !data) {
          setError(archiveError?.code === "42501"
            ? "Your role or branch access does not allow archiving this staff member."
            : "Could not archive this shared staff record. No row was removed.");
          return;
        }
        setSharedStaff((previous) => previous.filter((item) => item.id !== person.id));
        setDetailStaff(null);
        setNotice("Staff record archived. Salary and attendance history remain in the database.");
      } catch {
        setError("Could not archive this shared staff record. Check the connection and reload.");
      } finally {
        setSharedSaving(false);
      }
      return;
    }

    setStaff((previous) =>
      previous.filter((item) => item.id !== person.id)
    );
    setDetailStaff(null);
    setNotice("Staff record deleted.");
  }

  function recordSalaryPayment(person: Staff) {
    if (storageMode === "shared") {
      setError("Use the shared Payroll screen to record salary. This staff directory does not mark payments as paid.");
      return;
    }
    const netSalary = Math.max(
      0,
      (person.manualPayableAmount ?? (person.monthlySalary -
        (person.attendanceEnabled === false ? 0 : person.unpaidLeaveDays * person.deductionPerDay)))
    );

    setStaff((previous) =>
      previous.map((item) =>
        item.id === person.id
          ? {
              ...item,
              paidAmount: netSalary,
              salaryStatus: "Paid",
            }
          : item
      )
    );

    setDetailStaff((previous) =>
      previous?.id === person.id
        ? { ...previous, paidAmount: netSalary, salaryStatus: "Paid" }
        : previous
    );

    setNotice("Salary marked as paid. Please ensure the payment was actually made.");
  }

  const workspaceScopePending = storageMode === "shared" && (workspaceScope.loading || (!!workspaceScope.selection
    && memberships.some((item) => item.instituteId === workspaceScope.selection?.instituteId)
    && (selectedInstituteId !== workspaceScope.selection.instituteId || (selectedBranchId === "all" ? "" : selectedBranchId) !== workspaceScope.selection.branchId)));

  if (workspaceScopePending) {
    return <WorkspaceLayout><main className="mx-auto max-w-7xl p-4"><div role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading records for the selected institute and branch…</div></main></WorkspaceLayout>;
  }


  if (!loaded) {
    return (
      <WorkspaceLayout>
        <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-5">
          <div className="h-28 animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </WorkspaceLayout>
    );
  }

  return (
    <WorkspaceLayout>
      <main className="bizbook-dashboard-canvas min-h-screen bg-[#f5f5f7]">
        <section className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
          {/* Vibrant BizBook gradient header */}
          <header className="relative isolate overflow-hidden rounded-[22px] bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#a21caf] px-4 py-3.5 text-white shadow-[0_12px_30px_rgba(91,33,182,0.18)] sm:px-5 sm:py-4 lg:px-6">
            <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-20 h-44 w-44 rounded-full border border-white/10" />
            <div aria-hidden="true" className="pointer-events-none absolute -right-1 top-2 h-32 w-32 rounded-full border border-white/10" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-[18%] h-44 w-44 rounded-full border border-white/10" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(255,255,255,0.13),transparent_30%),radial-gradient(circle_at_18%_110%,rgba(217,70,239,0.20),transparent_38%)]" />

            <div className="relative flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.15em] text-white/90 shadow-sm backdrop-blur-sm sm:text-[11px]">
                  <span className="size-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.9)]" aria-hidden="true" />
                  BIZBOOK · MY BUSINESS
                </p>
                <h1 className="mt-2 text-[23px] font-black leading-[1.05] tracking-[-0.05em] text-white sm:text-3xl">
                  Students <span className="bg-gradient-to-r from-amber-200 via-pink-200 to-fuchsia-200 bg-clip-text text-transparent">&amp; Staff</span>
                </h1>
                <p className="mt-1.5 max-w-2xl text-[11px] leading-4 text-violet-100/95 sm:text-xs sm:leading-5">
                  Manage admissions, fee installments, staff records and salary details — all in one place.
                </p>
              </div>

              <div className="relative flex shrink-0 flex-wrap items-center gap-2">
                {tab === "students" && (
                  <button
                    type="button"
                    onClick={downloadStudentsCsv}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm backdrop-blur-sm transition hover:border-white/40 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Download size={15} />
                    Export CSV
                  </button>
                )}
                <button
                  type="button"
                  onClick={openAddStudent}
                  disabled={sharedSaving || (storageMode === "shared" && !canManageSharedStudents)}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-white px-3 py-1.5 text-[11px] font-extrabold text-violet-800 shadow-[0_5px_16px_rgba(30,10,70,0.18)] transition hover:-translate-y-0.5 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-violet-800"
                >
                  <Plus size={15} /> Add Student
                </button>
                <button
                  type="button"
                  onClick={openAddStaff}
                  disabled={sharedSaving || (storageMode === "shared" && !canManageSharedStudents)}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur-sm transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <Plus size={15} /> Add Staff
                </button>
              </div>
            </div>

            <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/20 pt-2.5 text-[10px] sm:mt-4 sm:text-[11px]">
              <p className="text-violet-100">
                Workspace: <span className="font-bold text-white">{tab === "students" ? "Student management" : "Staff management"}</span>
              </p>
              <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 font-semibold text-white/95 backdrop-blur-sm">
                {students.length} students <span className="text-white/50">·</span> {staff.length} staff
              </span>
            </div>
          </header>

          {(storageMode === "shared" && !memberships.length || supabaseConfigured && !authorizedTestProjectConfigured || storageMode === "shared" && !canManageSharedStudents && selectedMembership) && (
            <div className="space-y-2">
              {storageMode === "shared" && !memberships.length && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Sign in and join or create an institute before loading shared records.</p>}
              {supabaseConfigured && !authorizedTestProjectConfigured && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Shared records are disabled unless this workspace is configured for the authorized test project.</p>}
              {storageMode === "shared" && !canManageSharedStudents && selectedMembership && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">You can view accessible students, but only an institute owner or administrator can change student records.</p>}
            </div>
          )}

          {notice && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <span className="flex items-center gap-2">
                <CheckCircle2 size={17} />
                {notice}
              </span>
              <button
                type="button"
                onClick={() => setNotice("")}
                aria-label="Dismiss message"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {planLimitNotice && !studentModal && !staffModal && <PlanLimitNoticeCard notice={planLimitNotice} />}
          {error && !studentModal && !staffModal && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {storageMode === "shared" && sharedLoading && <p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading shared students and installment balances…</p>}

          {/* Metrics */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
            {storageMode === "shared" && !canViewSharedFinance ? (
              <>
                <MetricCard icon={<Wallet size={17} />} label={tab === "students" ? "Fee totals" : "Salary totals"} value="Restricted" description="A finance role is required" color="orange" />
                <MetricCard icon={<CreditCard size={17} />} label={tab === "students" ? "Receipt totals" : "Salary payments"} value="Restricted" description="A finance role is required" color="green" />
              </>
            ) : (
              <>
                <MetricCard
                  icon={<Wallet size={17} />}
                  label={tab === "students" ? (storageMode === "shared" ? "Installment outstanding" : "Outstanding Fees") : "Monthly Salary"}
                  value={money(tab === "students" ? studentStats.pending : staffStats.salaryObligation)}
                  description={
                    tab === "students"
                      ? `${money(studentStats.overdue)} overdue installments; admission fee receipt status is separate`
                      : "After configured leave deductions"
                  }
                  color={tab === "students" ? "orange" : "green"}
                />
                <MetricCard
                  icon={<CreditCard size={17} />}
                  label={tab === "students" ? "Fees Collected" : "Salary Pending"}
                  value={money(tab === "students" ? studentStats.collected : staffStats.pending)}
                  description={
                    tab === "students"
                      ? `Against ${money(studentStats.totalFee)} assigned fees; receipts counted once, completed refunds deducted`
                      : "Unpaid salary balance"
                  }
                  color={tab === "students" ? "green" : "red"}
                />
              </>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => {
                setTab("students");
                setSearch("");
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                tab === "students"
                  ? "bg-[#5B21B6] text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <GraduationCap size={17} />
              Students
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${tab === "students" ? "bg-white/15" : "bg-slate-100"}`}>
                {students.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab("staff");
                setSearch("");
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                tab === "staff"
                  ? "bg-[#5B21B6] text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <BriefcaseBusiness size={17} />
              Staff
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${tab === "staff" ? "bg-white/15" : "bg-slate-100"}`}>
                {staff.length}
              </span>
            </button>
          </div>

          {/* Records */}
          <section id="student-records" className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            {admissionCancellationWorkflow && <div role="status" className="border-b border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-950 sm:px-5"><strong>Admission cancellation:</strong> find the student, then choose <span className="font-semibold">Cancel admission</span>. You’ll be asked to record a reason; the financial history is preserved.</div>}
            <div className="border-b border-slate-100 p-3 sm:p-4">
              <div className="flex flex-col gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {tab === "students" ? "Student records" : "Staff records"}
                  </h2>
                  {tab === "staff" && (
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      Manage salary dates, leave deductions and payments.
                    </p>
                  )}
                </div>


              </div>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={
                      tab === "students"
                        ? "Search name, course or mobile..."
                        : "Search staff name, role or mobile..."
                    }
                    className={`${inputClass} pl-9`}
                  />
                </div>

                {(storageMode !== "shared" || tab === "students" || canViewSharedFinance) && <div className="relative sm:w-40">
                  <select
                    value={tab === "students" ? studentStatusFilter : staffStatusFilter}
                    onChange={(event) =>
                      tab === "students"
                        ? setStudentStatusFilter(event.target.value)
                        : setStaffStatusFilter(event.target.value)
                    }
                    className={`${inputClass} appearance-none pr-8`}
                  >
                    <option value="All">All statuses</option>
                    <option value="Paid">Paid</option>
                    <option value="Pending">Pending</option>
                    {tab === "students" && <option value="Overdue">Overdue</option>}
                  </select>
                  <ChevronDown
                    size={15}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                </div>}
              </div>
            </div>

            {tab === "students" ? (
              filteredStudents.length === 0 ? (
                <div className="px-5 py-14 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                    <GraduationCap size={23} />
                  </div>
                  <h3 className="mt-3 text-sm font-bold text-slate-800">
                    No students found
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Add a student or change your search filters.
                  </p>
                  <button
                    type="button"
                    onClick={openAddStudent}
                    disabled={storageMode === "shared" && !canManageSharedStudents}
                    className={`${primaryButton} mt-4`}
                  >
                    <Plus size={15} />
                    Add Student
                  </button>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto overscroll-x-contain p-0">
                    <div className="min-w-[900px] space-y-0">
                    {filteredStudents.map((student) => {
                      const paid = storageMode === "shared"
                        ? Number(student.collectedAmount) || 0
                        : (student.admissionFee ?? 0) + student.installments
                            .filter((i) => i.status === "Paid")
                            .reduce((sum, i) => sum + i.amount, 0);

                      const due = storageMode === "shared"
                        ? (Number(student.admissionOutstandingAmount) || 0) + student.installments.reduce((sum, installment) => sum + (Number(installment.outstandingAmount) || 0), 0)
                        : student.installments
                            .filter((i) => i.status !== "Paid")
                            .reduce((sum, i) => {
                              const explicitOutstanding = Number(i.outstandingAmount);
                              const paidAmount = Number(i.paidAmount) || 0;
                              const remaining = Number.isFinite(explicitOutstanding)
                                ? Math.max(0, explicitOutstanding)
                                : Math.max(0, i.amount - paidAmount);
                              return sum + remaining;
                            }, 0);

                      const overdue = (storageMode === "shared" && student.admissionStatus === "Overdue") || student.installments.some(
                        (i) => dueStatus(i, todayDate) === "Overdue"
                      );
                      const status = storageMode === "shared"
                        ? paid >= student.totalFee ? "Paid" : overdue ? "Overdue" : "Pending"
                        : due === 0 ? "Paid" : overdue ? "Overdue" : "Pending";

                      const feeProgress = student.totalFee > 0
                        ? Math.min(100, Math.max(0, (due / student.totalFee) * 100))
                        : 0;
                      // Color is based on the percentage of total fees still outstanding.
                      // Green: <=25%; yellow: >25% through 50%; red: >50%.
                      const feeProgressColor = due <= 0 || feeProgress <= 25
                        ? "bg-emerald-500"
                        : feeProgress <= 50
                          ? "bg-amber-400"
                          : "bg-rose-500";

                      return (
                        <article
                          key={student.id}
                          className="w-full min-w-0 rounded-lg border border-violet-300 bg-white px-3 py-2.5 shadow-none transition-colors duration-150 odd:bg-white even:bg-violet-50/60 hover:border-violet-500 hover:bg-violet-50 sm:px-4 [&+article]:-mt-px"
                        >
                          {/* Horizontal student row: both contact numbers stay visible */}
                          <div className="grid min-w-0 grid-cols-[32px_minmax(135px,1.15fr)_minmax(85px,.65fr)_minmax(125px,.9fr)_minmax(125px,.9fr)_minmax(170px,1.1fr)] items-center gap-x-3">
                            <StudentAvatar
                              studentId={student.id}
                              name={student.name}
                              gender={student.gender ?? "Other"}
                              size={32}
                            />

                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                                <button
                                  type="button"
                                  onClick={() => setDetailStudent(student)}
                                  className="max-w-full truncate text-left text-[13px] font-extrabold leading-5 text-violet-950 transition-colors hover:text-fuchsia-700"
                                >
                                  {student.name}
                                </button>
                                <StatusBadge status={status} />
                              </div>
                              <p className="mt-0.5 truncate text-[10px] leading-4 text-slate-400">
                                ID: {student.id}
                              </p>
                            </div>

                            <div className="min-w-0">
                              <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-violet-500">Class</span>
                              <span className="block truncate text-[11px] font-bold text-slate-800">
                                {student.course || student.className || "Not set"}
                              </span>
                            </div>

                            <div className="min-w-0">
                              <span className="block text-[9px] font-bold uppercase tracking-[0.06em] text-sky-600">Guardian mobile</span>
                              <span className="block truncate text-[11px] font-semibold tabular-nums text-sky-900">
                                {student.parentMobile || "Not provided"}
                              </span>
                            </div>

                            <div className="min-w-0">
                              <span className="block text-[9px] font-bold uppercase tracking-[0.06em] text-emerald-600">WhatsApp mobile</span>
                              <span className="block truncate text-[11px] font-semibold tabular-nums text-emerald-900">
                                {student.whatsapp || "Not provided"}
                              </span>
                            </div>

                            {/* Outstanding balance and colored scale */}
                            <div className="min-w-0 pt-0.5">
                              <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
                                <strong className={`text-xs font-extrabold tabular-nums ${feeProgress <= 25 ? "text-emerald-700" : feeProgress <= 50 ? "text-amber-700" : "text-rose-700"}`}>
                                  {money(due)}
                                </strong>
                                <span className="text-[10px] font-medium text-slate-500">
                                  of {money(student.totalFee)}
                                </span>
                              </div>
                              <div
                                className="mt-1.5 h-[6px] w-full overflow-hidden rounded-full bg-slate-200/90 ring-1 ring-inset ring-black/[0.025]"
                                role="progressbar"
                                aria-label={`Outstanding fee balance for ${student.name}`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(feeProgress)}
                              >
                                <div
                                  className={`h-full rounded-full shadow-[0_0_7px_rgba(0,0,0,0.10)] transition-[width] duration-300 ${feeProgressColor}`}
                                  style={{ width: `${feeProgress}%` }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Small actions directly below each student */}
                          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-violet-100/80 pt-1.5 pl-[44px]">
                            <button
                              type="button"
                              onClick={() => setDetailStudent(student)}
                              aria-label={`View and manage installments for ${student.name}`}
                              className="inline-flex min-h-6 items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-violet-700 transition hover:bg-violet-50"
                            >
                              <BookOpen size={13} className="shrink-0" />
                              <span>Installments</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditStudent(student)}
                              disabled={storageMode === "shared" && !canManageSharedStudents}
                              className="inline-flex min-h-6 items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Pencil size={13} className="shrink-0" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDetailStudent(student)}
                              aria-label={`View details for ${student.name}`}
                              title="View details"
                              className="inline-flex min-h-6 items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-100"
                            >
                              <Eye size={13} className="shrink-0" />
                              <span>Details</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => storageMode === "shared" ? (setCancellationReason(""), setCancellingStudent(student)) : deleteStudent(student)}
                              disabled={storageMode === "shared" && (!canManageSharedStudents || sharedSaving)}
                              aria-label={`Cancel admission for ${student.name}`}
                              title="Cancel admission"
                              className="inline-flex min-h-6 items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {storageMode === "shared" ? <CircleX size={13} /> : <Trash2 size={13} />}
                              <span>Cancel admission</span>
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    </div>
                  </div>
                </>
              )
            ) : filteredStaff.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                  <BriefcaseBusiness size={23} />
                </div>
                <h3 className="mt-3 text-sm font-bold text-slate-800">
                  No staff records found
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Add a staff member or change your search filters.
                </p>
                <button
                  type="button"
                  onClick={openAddStaff}
                  className={`${primaryButton} mt-4`}
                >
                  <Plus size={15} />
                  Add Staff
                </button>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Staff member</th>
                        <th className="px-4 py-3 font-semibold">Role</th>
                        <th className="px-4 py-3 font-semibold">Joining date</th>
                        {(storageMode !== "shared" || canViewSharedFinance) && <th className="px-4 py-3 font-semibold">Monthly salary</th>}
                        <th className="px-5 py-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredStaff.map((person) => {
                        return (
                          <tr key={person.id} className="hover:bg-slate-50/70">
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-3">
                                <StudentAvatar studentId={person.id} name={person.name} gender={person.gender ?? "Other"} size={42} />
                                <div className="min-w-0">
                                  <p className="font-semibold text-slate-800">{person.name}</p>
                                  <span className="mt-1 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{person.gender ?? "Other"}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-slate-600">{person.designation}</td>
                            <td className="px-4 py-3.5 text-slate-600">{person.joiningDate || "—"}</td>
                            {(storageMode !== "shared" || canViewSharedFinance) && <td className="px-4 py-3.5 font-semibold">{money(person.monthlySalary)}</td>}
                            <td className="px-5 py-3.5">
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setDetailStaff(person)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-violet-50 hover:text-violet-700"
                                >
                                  <BookOpen size={14} /> Details
                                </button>
                                <button
                                  type="button"
                                  title="Edit staff"
                                  onClick={() => openEditStaff(person)}
                                  disabled={sharedSaving || (storageMode === "shared" && !canManageSharedStudents)}
                                  className="rounded-lg p-2 text-slate-500 hover:bg-amber-50 hover:text-amber-700"
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  type="button"
                                  title="Delete staff"
                                  onClick={() => deleteStaff(person)}
                                  disabled={sharedSaving || (storageMode === "shared" && !canManageSharedStudents)}
                                  className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-700"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3 p-2.5 sm:p-3 md:hidden">
                  {filteredStaff.map((person) => {
                    return (
                      <div key={person.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="flex min-w-0 items-center gap-3">
                          <StudentAvatar studentId={person.id} name={person.name} gender={person.gender ?? "Other"} size={40} />
                          <div className="min-w-0 flex-1">
                            <h3 className="break-words text-sm font-bold text-slate-900">{person.name}</h3>
                            <p className="mt-1 text-xs text-slate-500">{person.designation}</p>
                            <p className="mt-1 text-xs font-semibold text-violet-700">Mobile: {person.mobile || "—"}</p>
                            <p className="mt-1 text-xs font-semibold text-emerald-700">WhatsApp: {person.whatsapp || "—"}</p>
                            <p className="mt-1 text-xs text-slate-400">Joined {person.joiningDate || "—"} · Salary day {person.paymentDate || 1}</p>
                          </div>
                        </div>

                        {(storageMode !== "shared" || canViewSharedFinance) && <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                          <p className="text-xs text-slate-500">Monthly salary</p>
                          <p className="mt-0.5 text-base font-bold text-slate-900">{money(person.monthlySalary)}</p>
                        </div>}

                        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                          <button
                            type="button"
                            onClick={() => setDetailStaff(person)}
                            className={`${secondaryButton} min-w-0 px-2 text-xs sm:text-sm`}
                          >
                            <BookOpen size={14} /> Details
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditStaff(person)}
                            disabled={sharedSaving || (storageMode === "shared" && !canManageSharedStudents)}
                            className={`${secondaryButton} min-w-0 px-2 text-xs sm:text-sm`}
                          >
                            <Pencil size={14} /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteStaff(person)}
                            disabled={sharedSaving || (storageMode === "shared" && !canManageSharedStudents)}
                            aria-label={`Delete ${person.name}`}
                            className="inline-flex items-center justify-center rounded-lg border border-red-100 px-3 py-2 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          {/* Student modal */}
          {studentModal && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-4">
              <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:max-w-2xl sm:rounded-2xl sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {editingStudentId ? "Edit student" : "Add student"}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Admission details and course fee setup
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStudentModal(false)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                    aria-label="Close student form"
                  >
                    <X size={20} />
                  </button>
                </div>

                {planLimitNotice?.resource === "student" && <PlanLimitNoticeCard notice={planLimitNotice} />}
                {error && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <form onSubmit={saveStudent} className="space-y-5">
                  {storageMode === "shared" && selectedMembership?.accessScope === "branches" && branches.length > 1 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <label className="block text-xs font-semibold text-slate-700">
                        Assigned workspace
                        <select required={selectedMembership?.accessScope === "branches"} value={studentBranchId} onChange={(event) => setStudentBranchId(event.target.value)} className={`${inputClass} mt-1.5`}>
                          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                  <div>
                    <SectionTitle
                      icon={<UserRound size={17} />}
                      title="Student details"
                      subtitle="Add guardian contact details and record their communication consent."
                    />

                    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/80 p-3.5">
                      <p className="text-xs font-bold text-violet-950">Fee reminder schedule is managed by BizBook</p>
                      <p className="mt-1 text-xs leading-5 text-violet-900">Company policy controls reminder dates, send times, frequency, and channels. These consent checkboxes only record what the parent or guardian has agreed to receive; reminders are sent only through consented channels.</p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Student name *
                        </label>
                        <input
                          required
                          maxLength={100}
                          value={studentForm.name}
                          onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                          placeholder="Full name"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Parent / Guardian name *
                        </label>
                        <input
                          required
                          maxLength={100}
                          value={studentForm.parentName}
                          onChange={(e) => setStudentForm({ ...studentForm, parentName: e.target.value })}
                          placeholder="Parent or guardian full name"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Gender *</label>
                        <select
                          required
                          value={studentForm.gender}
                          onChange={(e) => setStudentForm({ ...studentForm, gender: e.target.value as "Male" | "Female" | "Other" })}
                          className={inputClass}
                        >
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Parent / Guardian email (optional)
                        </label>
                        <input
                          type="email"
                          maxLength={254}
                          value={studentForm.parentEmail}
                          onChange={(e) => setStudentForm({ ...studentForm, parentEmail: e.target.value.trimStart() })}
                          placeholder="Used for fee reminders"
                          className={inputClass}
                        />
                        <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={studentForm.parentEmailOptIn}
                            onChange={(e) => setStudentForm({ ...studentForm, parentEmailOptIn: e.target.checked })}
                            className="mt-0.5"
                          />
                          <span>Consent recorded: automated fee reminders by email.</span>
                        </label>
                        <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={studentForm.emailReceiptOptIn}
                            onChange={(e) => setStudentForm({ ...studentForm, emailReceiptOptIn: e.target.checked })}
                            className="mt-0.5"
                          />
                          <span>Parent/guardian agreed to receive payment receipts by email.</span>
                        </label>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Parent mobile number *
                        </label>
                        <input
                          required
                          inputMode="numeric"
                          maxLength={10}
                          value={studentForm.parentMobile}
                          onChange={(e) => setStudentForm({ ...studentForm, parentMobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                          placeholder="10-digit number"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          WhatsApp mobile number *
                        </label>
                        <input
                          required
                          inputMode="numeric"
                          maxLength={10}
                          value={studentForm.whatsapp}
                          onChange={(e) => setStudentForm({ ...studentForm, whatsapp: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                          placeholder="Number used for reminders"
                          className={inputClass}
                        />
                        <p className="mt-1 text-[11px] text-slate-400">
                          Confirm with the parent before saving.
                        </p>
                        <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={studentForm.whatsappOptIn}
                            onChange={(e) => setStudentForm({ ...studentForm, whatsappOptIn: e.target.checked })}
                            className="mt-0.5"
                          />
                          <span>Consent recorded: automated fee reminders by WhatsApp.</span>
                        </label>
                        <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={studentForm.whatsappReceiptOptIn}
                            onChange={(e) => setStudentForm({ ...studentForm, whatsappReceiptOptIn: e.target.checked })}
                            className="mt-0.5"
                          />
                          <span>Parent/guardian agreed to receive payment receipts as PDF documents by WhatsApp.</span>
                        </label>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Admission date *
                        </label>
                        <input
                          required
                          type="date"
                          value={studentForm.admissionDate}
                          disabled={hasRecordedAdmissionPayment(editingStudentId ? students.find((student) => student.id === editingStudentId) : undefined)}
                          onChange={(e) => setStudentForm({ ...studentForm, admissionDate: e.target.value })}
                          className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500`}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Choose class/course or enter manually *
                        </label>
                        <input
                          required
                          list="bizbook-courses"
                          maxLength={100}
                          value={studentForm.course}
                          onChange={(e) => setStudentForm({ ...studentForm, course: e.target.value })}
                          placeholder="Select or type a course name"
                          className={inputClass}
                        />
                        <datalist id="bizbook-courses">
                          <option value="Class 6" />
                          <option value="Class 7" />
                          <option value="Class 8" />
                          <option value="Class 9" />
                          <option value="Class 10" />
                          <option value="Class 11" />
                          <option value="Class 12" />
                          <option value="JEE Preparation" />
                          <option value="NEET Preparation" />
                          <option value="Other" />
                        </datalist>
                      </div>
                    </div>
                  </div>


                  <div className="border-t border-slate-100 pt-5">
                    <SectionTitle
                      icon={<Wallet size={17} />}
                      title="Course fee & installments"
                      subtitle="Set a total fee and create a monthly or manual payment schedule."
                    />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Admission fee (₹) *
                        </label>
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          max={studentForm.totalFee || undefined}
                          value={studentForm.admissionFee}
                          disabled={hasRecordedAdmissionPayment(editingStudentId ? students.find((student) => student.id === editingStudentId) : undefined)}
                          onChange={(e) => setStudentForm({ ...studentForm, admissionFee: e.target.value })}
                          placeholder="e.g. 2000"
                          className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500`}
                        />
                        <p className="mt-1 text-[11px] text-slate-400">{hasRecordedAdmissionPayment(editingStudentId ? students.find((student) => student.id === editingStudentId) : undefined) ? "Locked because a payment has been recorded." : "Due on the admission date. Record a fee receipt when it is collected."}</p>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Total course fee (₹) *
                        </label>
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          value={studentForm.totalFee}
                          onChange={(e) => setStudentForm({ ...studentForm, totalFee: e.target.value })}
                          placeholder="e.g. 24000"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Installment method *
                        </label>
                        <select
                          value={studentForm.installmentMode}
                          onChange={(e) => setStudentForm({
                            ...studentForm,
                            installmentMode: e.target.value as "automatic" | "manual",
                          })}
                          disabled={Boolean(editingStudentId)}
                          className={inputClass}
                        >
                          <option value="automatic">Automatic monthly</option>
                          <option value="manual">Manual installments</option>
                        </select>
                        {editingStudentId && <p className="mt-1 text-[11px] text-slate-500">Existing installment rows keep their payment and reminder history while you edit this student.</p>}
                      </div>
                    </div>

                    {studentForm.installmentMode === "automatic" ? (
                      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                            Number of installments
                          </label>
                          <select
                            value={studentForm.installmentCount}
                            onChange={(e) => setStudentForm({ ...studentForm, installmentCount: e.target.value })}
                            className={inputClass}
                          >
                            {[1, 2, 3, 4, 6, 8, 10, 12, 18, 24, 36, 48, 60].map((count) => (
                              <option key={count} value={String(count)}>
                                {count} {count === 1 ? "installment" : "installments"}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                            First due date
                          </label>
                          <input
                            required
                            type="date"
                            value={studentForm.firstDueDate}
                            onChange={(e) => setStudentForm({ ...studentForm, firstDueDate: e.target.value })}
                            className={inputClass}
                          />
                        </div>

                        <div className="sm:col-span-2 rounded-lg border border-violet-100 bg-violet-50 p-3">
                          <p className="text-xs font-semibold text-[#5B21B6]">
                            <Calculator size={14} className="mr-1 inline" />
                            Estimated installment amount
                          </p>
                          <p className="mt-1 text-lg font-bold text-[#5B21B6]">
                            {money(
                              Math.max(0, (Number(studentForm.totalFee) || 0) - (Number(studentForm.admissionFee) || 0)) /
                                Number(studentForm.installmentCount)
                            )}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Admission fee is deducted first. Remaining fee is divided across installments; the final installment handles rounding.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-700">
                            Manual installment schedule
                          </p>
                          <button
                            type="button"
                            onClick={() => setStudentForm({
                              ...studentForm,
                              manualInstallments: [
                                ...studentForm.manualInstallments,
                                { amount: "", dueDate: todayDate, installmentId: undefined, locked: false },
                              ],
                            })}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Plus size={13} />
                            Add installment
                          </button>
                        </div>

                        {studentForm.manualInstallments.map((item, index) => (
                          <div key={item.installmentId ?? `new-${index}`} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                            <div>
                              <label className="mb-1 block text-[11px] text-slate-500">
                                Amount (₹)
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.amount}
                                disabled={item.locked}
                                onChange={(e) => {
                                  const updated = [...studentForm.manualInstallments];
                                  updated[index] = { ...updated[index], amount: e.target.value };
                                  setStudentForm({ ...studentForm, manualInstallments: updated });
                                }}
                                placeholder="Amount"
                                className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500`}
                              />
                              {item.locked && <p className="mt-1 text-[10px] font-semibold text-emerald-700">Payment recorded · amount locked</p>}
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-slate-500">
                                Due date
                              </label>
                              <input
                                type="date"
                                value={item.dueDate}
                                disabled={item.locked}
                                onChange={(e) => {
                                  const updated = [...studentForm.manualInstallments];
                                  updated[index] = { ...updated[index], dueDate: e.target.value };
                                  setStudentForm({ ...studentForm, manualInstallments: updated });
                                }}
                                className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500`}
                              />
                            </div>
                            <button
                              type="button"
                              disabled={studentForm.manualInstallments.length === 1 || item.locked || studentForm.manualInstallments.slice(index + 1).some((later) => later.locked)}
                              onClick={() => setStudentForm({
                                ...studentForm,
                                manualInstallments: studentForm.manualInstallments.filter((_, i) => i !== index),
                              })}
                              aria-label={`Remove installment ${index + 1}`}
                              className="mb-0.5 rounded-lg p-2.5 text-red-600 hover:bg-red-50 disabled:opacity-30"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))}

                        <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-xs">
                          <span className="text-slate-500">Installments total</span>
                          <span className="font-bold text-slate-800">
                            {money(studentForm.manualInstallments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0))}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setStudentModal(false)}
                      className={secondaryButton}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={sharedSaving || (storageMode === "shared" && !canManageSharedStudents)} className={primaryButton}>
                      <Save size={15} />
                      {sharedSaving ? "Saving…" : editingStudentId ? "Save Changes" : "Add Student"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Staff modal */}
          {staffModal && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-4">
              <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:max-w-2xl sm:rounded-2xl sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {editingStaffId ? "Edit staff member" : "Add staff member"}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Basic staff details and salary calculation preferences
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStaffModal(false)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                    aria-label="Close staff form"
                  >
                    <X size={20} />
                  </button>
                </div>

                {planLimitNotice?.resource === "staff" && <PlanLimitNoticeCard notice={planLimitNotice} />}
                {error && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <form onSubmit={saveStaff} className="space-y-5">
                  <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 sm:p-5" aria-labelledby="staff-salary-mode-title">
                    <div>
                      <h3 id="staff-salary-mode-title" className="text-sm font-extrabold text-slate-900">Choose this staff member&apos;s salary mode</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-600">This setting is saved with the staff record and controls the monthly payroll calculation.</p>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2" role="group" aria-label="Salary calculation mode">
                      <button
                        type="button"
                        aria-pressed={staffForm.attendanceEnabled}
                        onClick={() => setStaffForm((form) => ({ ...form, attendanceEnabled: true, manualPayableAmount: "" }))}
                        className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 ${staffForm.attendanceEnabled ? "border-violet-500 bg-violet-700 text-white shadow-md" : "border-slate-200 bg-white text-slate-800 hover:border-violet-300"}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold">Attendance-based salary</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wide ${staffForm.attendanceEnabled ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>{staffForm.attendanceEnabled ? "ON" : "SELECT"}</span>
                        </span>
                        <span className={`mt-1 block text-xs leading-5 ${staffForm.attendanceEnabled ? "text-violet-100" : "text-slate-500"}`}>Recorded absent or leave days can reduce monthly pay by the configured deduction.</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={!staffForm.attendanceEnabled}
                        onClick={() => setStaffForm((form) => ({ ...form, attendanceEnabled: false, manualPayableAmount: "" }))}
                        className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 ${!staffForm.attendanceEnabled ? "border-violet-500 bg-violet-700 text-white shadow-md" : "border-slate-200 bg-white text-slate-800 hover:border-violet-300"}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold">Fixed monthly salary</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wide ${!staffForm.attendanceEnabled ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>{!staffForm.attendanceEnabled ? "ON" : "SELECT"}</span>
                        </span>
                        <span className={`mt-1 block text-xs leading-5 ${!staffForm.attendanceEnabled ? "text-violet-100" : "text-slate-500"}`}>Monthly pay stays fixed; attendance is still recorded but does not change salary.</span>
                      </button>
                    </div>
                  </section>
                  {storageMode === "shared" && selectedMembership?.accessScope === "branches" && branches.length > 1 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <label className="block text-xs font-semibold text-slate-700">
                        Assigned workspace
                        {editingStaffId ? (
                          <p className="mt-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700">
                            {branches.find((branch) => branch.id === staffBranchId)?.name ?? "Existing restricted assignment"}. Existing attendance and payroll history keep their scope.
                          </p>
                        ) : (
                          <select required={selectedMembership?.accessScope === "branches"} value={staffBranchId} onChange={(event) => setStaffBranchId(event.target.value)} className={`${inputClass} mt-1.5`}>
                            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                          </select>
                        )}
                      </label>
                    </div>
                  )}
                  <div>
                    <SectionTitle
                      icon={<UserRound size={17} />}
                      title="Staff details"
                      subtitle="Basic information for your employee records."
                    />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Staff name *
                        </label>
                        <input
                          required
                          maxLength={100}
                          value={staffForm.name}
                          onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                          placeholder="Full name"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Designation *
                        </label>
                        <input
                          required
                          maxLength={80}
                          value={staffForm.designation}
                          onChange={(e) => setStaffForm({ ...staffForm, designation: e.target.value })}
                          placeholder="Teacher, receptionist, trainer..."
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Mobile number *
                        </label>
                        <input
                          required
                          inputMode="numeric"
                          maxLength={10}
                          value={staffForm.mobile}
                          onChange={(e) => setStaffForm({ ...staffForm, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                          placeholder="10-digit mobile number"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          WhatsApp number *
                        </label>
                        <input
                          required
                          inputMode="numeric"
                          maxLength={10}
                          value={staffForm.whatsapp}
                          onChange={(e) => setStaffForm({ ...staffForm, whatsapp: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                          placeholder="10-digit WhatsApp number"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Joining date *
                        </label>
                        <input
                          required
                          type="date"
                          value={staffForm.joiningDate}
                          onChange={(e) => setStaffForm({ ...staffForm, joiningDate: e.target.value })}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-5">
                    <SectionTitle
                      icon={<Wallet size={17} />}
                      title="Salary & leave settings"
                      subtitle="Set the monthly salary and deduction for each absent day."
                    />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Monthly salary (₹) *
                        </label>
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          value={staffForm.monthlySalary}
                          onChange={(e) => setStaffForm({ ...staffForm, monthlySalary: e.target.value })}
                          placeholder="e.g. 15000"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Salary payment date every month *
                        </label>
                        <select
                          required
                          value={staffForm.paymentDate}
                          onChange={(e) => setStaffForm({ ...staffForm, paymentDate: e.target.value })}
                          className={inputClass}
                        >
                          {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                            <option key={day} value={String(day)}>
                              {day}{day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th"} of every month
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Salary will appear in the Salary section as pending for each month until marked paid.
                        </p>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Deduction per leave day (₹) *
                        </label>
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          value={staffForm.deductionPerDay}
                          onChange={(e) => setStaffForm({ ...staffForm, deductionPerDay: e.target.value })}
                          placeholder="e.g. 500"
                          className={inputClass}
                        />
                      </div>

                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                        Manual payable override (₹) — optional
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={staffForm.manualPayableAmount}
                        onChange={(e) => setStaffForm({ ...staffForm, manualPayableAmount: e.target.value })}
                        placeholder="Leave blank to use the selected salary mode"
                        className={inputClass}
                      />
                      <p className="mt-1 text-[11px] leading-4 text-slate-500">
                        An entered amount overrides the selected attendance/fixed calculation. Clear it to return to automatic calculation.
                      </p>
                    </div>

                    <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#5B21B6]">
                        <Calculator size={17} />
                        Salary calculation
                      </div>

                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-600">Monthly salary</span>
                          <span className="font-medium">{money(Number(staffForm.monthlySalary) || 0)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-600">
                            Leave deduction ({staffForm.attendanceEnabled ? (Number(staffForm.unpaidLeaveDays) || 0) : 0} × {money(Number(staffForm.deductionPerDay) || 0)})
                          </span>
                          <span className="font-medium text-red-600">
                            −{money(staffForm.attendanceEnabled ? (Number(staffForm.unpaidLeaveDays) || 0) * (Number(staffForm.deductionPerDay) || 0) : 0)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3 border-t border-violet-100 pt-2">
                          <span className="font-semibold text-slate-800">Net salary payable</span>
                          <span className="text-lg font-bold text-[#5B21B6]">
                            {money(
                              staffForm.manualPayableAmount.trim() !== "" && Number.isFinite(Number(staffForm.manualPayableAmount))
                                ? Math.max(0, Number(staffForm.manualPayableAmount))
                                : Math.max(
                                    0,
                                    (Number(staffForm.monthlySalary) || 0) -
                                      (staffForm.attendanceEnabled ? (Number(staffForm.unpaidLeaveDays) || 0) : 0) *
                                        (Number(staffForm.deductionPerDay) || 0)
                                  )
                            )}
                          </span>
                        </div>
                      </div>

                      <p className="mt-2 text-[11px] leading-4 text-slate-500">
                        {staffForm.manualPayableAmount.trim()
                          ? "The manual payable amount currently overrides the selected salary mode."
                          : staffForm.attendanceEnabled
                            ? "Attendance mode is ON: recorded absent and leave days are used for this month’s estimate."
                            : "Attendance mode is OFF: the payable remains equal to the fixed monthly salary."}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setStaffModal(false)}
                      className={secondaryButton}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={sharedSaving || (storageMode === "shared" && !canManageSharedStudents)} className={primaryButton}>
                      <Save size={15} />
                      {editingStaffId ? "Save Changes" : "Add Staff"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Student details */}
          {detailStudent && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-4">
              <div className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl">
                <div className="sticky top-0 z-20 flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 bg-white p-4 sm:p-6">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-slate-900">{detailStudent.name}</h2>
                    <p className="mt-1 text-xs text-slate-500">{detailStudent.course} · Admission: {detailStudent.admissionDate}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailStudent(null)}
                    aria-label="Close student details"
                    className="rounded-lg p-2 hover:bg-slate-100"
                  >
                    <X size={19} />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
                <div className="mt-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Total fee</p>
                    <p className="mt-1 font-bold">{money(detailStudent.totalFee)}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs text-emerald-700">{storageMode === "shared" ? "Configured admission fee" : "Admission fee · Paid"}</p>
                    <p className="mt-1 font-bold text-emerald-800">{money(detailStudent.admissionFee ?? 0)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Installments</p>
                    <p className="mt-1 font-bold">{detailStudent.installments.length}</p>
                  </div>
                </div>

                {storageMode !== "shared" || canManageSharedStudents ? <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const selected = detailStudent;
                      setDetailStudent(null);
                      openEditStudent(selected);
                    }}
                    className={secondaryButton}
                  >
                    <Pencil size={15} />
                    Edit student
                  </button>
                </div> : null}

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs text-emerald-700">{storageMode === "shared" ? "Installment paid" : "Installments paid"}</p>
                    <p className="mt-1 font-bold text-emerald-800">{money(detailStudent.installments.reduce((sum, item) => sum + (storageMode === "shared" ? Number(item.paidAmount) || 0 : item.status === "Paid" ? item.amount : 0), 0))}</p>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                    <p className="text-xs text-red-700">Installments outstanding</p>
                    <p className="mt-1 font-bold text-red-800">{money(detailStudent.installments.reduce((sum, item) => sum + (storageMode === "shared" ? Number(item.outstandingAmount) || 0 : item.status !== "Paid" ? item.amount : 0), 0))}</p>
                  </div>
                </div>

                {storageMode === "shared" && <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                    <p className="text-xs text-violet-700">Net receipts · fees and advances</p>
                    <p className="mt-1 font-bold text-violet-900">{money(Number(detailStudent.collectedAmount) || 0)}</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs text-amber-800">Admission fee paid · balance</p>
                    <p className="mt-1 font-bold text-amber-900">
                      {money(Number(detailStudent.admissionPaidAmount) || 0)} · {money(Number(detailStudent.admissionOutstandingAmount) || 0)}
                    </p>
                    <div className="mt-1"><StatusBadge status={detailStudent.admissionStatus ?? "Pending"} /></div>
                  </div>
                </div>}

                <h3 className="mb-2 mt-5 text-sm font-bold text-[#7C3AED]">
    
                </h3>

                <div className="space-y-2">
                  {detailStudent.installments.map((item) => (
                    <div key={item.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${item.status === "Paid" ? "border-emerald-200 bg-emerald-50" : item.status === "Partially Paid" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-[11px] font-bold ${item.status === "Paid" ? "bg-emerald-200 text-emerald-800" : item.status === "Partially Paid" ? "bg-amber-200 text-amber-800" : "bg-red-200 text-red-800"}`}>
                            {String(detailStudent.installments.findIndex((entry) => entry.id === item.id) + 1).padStart(2, "0")}
                          </span>
                          <p className={`text-sm font-bold ${item.status === "Paid" ? "text-emerald-800" : "text-red-800"}`}>{money(item.amount)}</p>
                          {(Number(item.paidAmount ?? 0) > 0 && item.status !== "Paid") && <p className="mt-1 text-[11px] font-semibold text-emerald-700">Paid {money(Number(item.paidAmount))} · Balance {money(Math.max(0, item.amount - Number(item.paidAmount)))}</p>}
                        </div>
                        <p className="mt-1 text-xs text-slate-600">Due: {item.dueDate}</p>
                        {hasRecordedInstallmentPayment(item)
                          ? <p className="mt-1 text-[11px] font-medium text-emerald-700">Payment history exists. This installment is locked.</p>
                          : <p className="mt-1 text-[11px] font-medium text-violet-700">The unpaid schedule will rebalance when you edit this installment.</p>}
                        <div className="mt-1">
                          <StatusBadge status={dueStatus(item, todayDate)} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                      {!hasRecordedInstallmentPayment(item) && (storageMode !== "shared" || canManageSharedStudents) && <button
                        type="button"
                        title="Edit installment amount and redistribute outstanding balance"
                        onClick={() => editInstallmentAmount(detailStudent.id, item.id)}
                        className={secondaryButton}
                      ><Pencil size={14} /> Edit amount</button>}
                      {item.status === "Paid" && (
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700">
                          <CheckCircle2 size={14} /> Paid
                        </span>
                      )}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="mt-4 text-[11px] leading-4 text-slate-400">
                  Payments are recorded separately in Payments &amp; Collections. Installment balances and statuses should reflect recorded payments and allocated advances.
                </p>
                </div>
              </div>
            </div>
          )}

          {/* Admission cancellation */}
          {cancellingStudent && (
            <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4" role="presentation">
              <section role="dialog" aria-modal="true" aria-labelledby="cancel-admission-title" className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="cancel-admission-title" className="text-lg font-bold text-slate-900">Cancel admission</h2>
                    <p className="mt-1 text-sm text-slate-600">{cancellingStudent.name} · {cancellingStudent.course}</p>
                  </div>
                  <button type="button" onClick={() => setCancellingStudent(null)} aria-label="Close cancellation dialog" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
                </div>
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
                  This closes the active admission and preserves the complete financial history. It does not waive fees, delete receipts, or issue a refund. Resolve any pending online payment first.
                </div>
                <label htmlFor="admission-cancellation-reason" className="mt-4 block text-sm font-semibold text-slate-800">Reason for cancellation</label>
                <textarea id="admission-cancellation-reason" value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} maxLength={500} rows={4} className={`${inputClass} mt-2 resize-y`} placeholder="Record why the admission is being cancelled (5–500 characters)." />
                <p className="mt-1 text-right text-xs text-slate-400">{cancellationReason.trim().length}/500</p>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={() => setCancellingStudent(null)} disabled={sharedSaving} className={secondaryButton}>Keep admission</button>
                  <button type="button" onClick={() => void cancelAdmission()} disabled={sharedSaving || cancellationReason.trim().length < 5 || cancellationReason.trim().length > 500} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                    <CircleX size={16} />
                    {sharedSaving ? "Cancelling…" : "Confirm cancellation"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* Edit installment amount */}
          {installmentEdit && (
            <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4">
              <div className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Edit installment amount</h2>
                    <p className="mt-1 text-xs text-slate-500">The amount cannot exceed the current outstanding balance.</p>
                  </div>
                  <button type="button" onClick={() => setInstallmentEdit(null)} aria-label="Close amount editor" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
                </div>
                <label className="mb-1.5 mt-5 block text-xs font-semibold text-slate-700">Amount (₹)</label>
                <input
                  autoFocus
                  type="number"
                  min={installmentEdit.minAmount}
                  max={installmentEdit.maxAmount}
                  step="0.01"
                  value={installmentEdit.amount}
                  onChange={(event) => {
                    const raw = event.target.value;
                    const numeric = Number(raw);
                    const capped = raw !== "" && Number.isFinite(numeric) && numeric > installmentEdit.maxAmount
                      ? String(installmentEdit.maxAmount)
                      : raw;
                    setInstallmentEdit({ ...installmentEdit, amount: capped });
                  }}
                  className={inputClass}
                />
                <p className="mt-2 rounded-lg bg-red-50 p-3 text-xs text-[#7C3AED]">
                  Allowed: <strong>{money(installmentEdit.minAmount)}–{money(installmentEdit.maxAmount)}</strong>. Other fully unpaid installments will automatically rebalance.
                </p>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={() => setInstallmentEdit(null)} className={secondaryButton}>Cancel</button>
                  <button type="button" onClick={saveInstallmentAmount} disabled={sharedSaving} className={primaryButton}><Save size={15} /> {sharedSaving ? "Saving…" : "Save amount"}</button>
                </div>
              </div>
            </div>
          )}

          {/* Staff details */}
          {detailStaff && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-4">
              <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-3">
                        <StudentAvatar studentId={detailStaff.id} name={detailStaff.name} gender={detailStaff.gender ?? "Other"} size={56} />
                        <div>
                          <h2 className="text-lg font-bold text-slate-900">{detailStaff.name}</h2>
                          <span className="mt-1 inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">{detailStaff.gender ?? "Other"}</span>
                        </div>
                      </div>
                    <p className="mt-1 text-xs text-slate-500">{detailStaff.designation} · Joined {detailStaff.joiningDate}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailStaff(null)}
                    aria-label="Close staff details"
                    className="rounded-lg p-2 hover:bg-slate-100"
                  >
                    <X size={19} />
                  </button>
                </div>

                {(() => {
                  const deduction = detailStaff.unpaidLeaveDays * detailStaff.deductionPerDay;
                  const net = Math.max(0, (detailStaff.manualPayableAmount ?? (detailStaff.monthlySalary - deduction)));
                  const balance = Math.max(0, net - detailStaff.paidAmount);

                  return (
                    <>
                      {storageMode !== "shared" || canViewSharedFinance ? <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs text-slate-500">Monthly salary</p>
                          <p className="mt-1 font-bold">{money(detailStaff.monthlySalary)}</p>
                        </div>
                        <div className="rounded-xl bg-emerald-50 p-3">
                          <p className="text-xs text-emerald-700">Net salary</p>
                          <p className="mt-1 font-bold text-emerald-800">{money(net)}</p>
                        </div>
                        <div className="rounded-xl bg-red-50 p-3">
                          <p className="text-xs text-red-600">Leave deduction</p>
                          <p className="mt-1 font-bold text-red-700">{money(deduction)}</p>
                        </div>
                        <div className="rounded-xl bg-amber-50 p-3">
                          <p className="text-xs text-amber-700">Salary balance</p>
                          <p className="mt-1 font-bold text-amber-800">{money(balance)}</p>
                        </div>
                      </div> : <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Salary details require an institute finance role.</p>}

                      {(storageMode !== "shared" || canViewSharedFinance) && <div className="mt-4 rounded-xl border border-slate-200 p-3 text-sm">
                        <p className="flex justify-between gap-3">
                          <span className="text-slate-500">Salary payment date</span>
                          <span className="font-semibold">Day {detailStaff.paymentDate} monthly</span>
                        </p>
                        <p className="mt-3 flex justify-between gap-3">
                          <span className="text-slate-500">Unpaid leave</span>
                          <span className="font-semibold">{detailStaff.unpaidLeaveDays} days</span>
                        </p>
                        <p className="mt-3 flex justify-between gap-3">
                          <span className="text-slate-500">Deduction per day</span>
                          <span className="font-semibold">{money(detailStaff.deductionPerDay)}</span>
                        </p>
                        <p className="mt-3 flex justify-between gap-3">
                          <span className="text-slate-500">Amount recorded as paid</span>
                          <span className="font-semibold">{money(detailStaff.paidAmount)}</span>
                        </p>
                      </div>}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const selected = detailStaff;
                            setDetailStaff(null);
                            openEditStaff(selected);
                          }}
                          disabled={sharedSaving || (storageMode === "shared" && !canManageSharedStudents)}
                          className={secondaryButton}
                        >
                          <Pencil size={15} />
                          Edit staff
                        </button>
                        {storageMode !== "shared" && detailStaff.paidAmount < net && (
                          <button
                            type="button"
                            onClick={() => recordSalaryPayment(detailStaff)}
                            className={primaryButton}
                          >
                            <CheckCircle2 size={15} />
                            Mark full salary paid
                          </button>
                        )}
                      </div>

                      {storageMode !== "shared" || canViewSharedFinance ? <p className="mt-4 text-[11px] leading-4 text-slate-400">
                        {storageMode === "shared"
                          ? `Showing shared attendance and salary payment records for ${todayDate.slice(0, 7)}. Use the Payroll screen to record a database-backed salary payment.`
                          : "Mark salary paid only after payment is actually made. This browser record does not process a bank transfer."}
                      </p> : null}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          <footer className="pb-2 text-center text-[10px] text-[#8e8e93]">
            BizBook · Students &amp; Staff Management
          </footer>
        </section>
      </main>
    </WorkspaceLayout>
  );
}
