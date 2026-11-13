export type BalanceReportMode = "outstanding" | "overdue";

export type BalanceReportStudent = {
  id: string;
  name: string;
  course: string | null;
  archived_at: string | null;
};

export type BalanceReportInstallment = {
  installment_id: string;
  student_id: string;
  branch_id: string | null;
  sequence_number: number;
  scheduled_amount: number | string;
  paid_amount: number | string;
  outstanding_amount: number | string;
  due_date: string | null;
  scheduled_status: string;
};

export type BalanceReportLine = {
  id: string;
  number: number;
  dueDate: string;
  scheduledMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  daysOverdue: number;
};

export type BalanceReportGroup = {
  studentId: string;
  studentName: string;
  course: string;
  archived: boolean;
  installments: BalanceReportLine[];
  totalMinor: number;
};

function toDateOrdinal(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 10) === value ? timestamp / 86_400_000 : null;
}

export function moneyToMinorUnits(value: number | string): number | null {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

export function groupStudentBalances(
  students: BalanceReportStudent[],
  balances: BalanceReportInstallment[],
  mode: BalanceReportMode,
  instituteBusinessDate: string,
): BalanceReportGroup[] {
  const studentsById = new Map(students.map((student) => [student.id, student]));
  const todayOrdinal = toDateOrdinal(instituteBusinessDate);
  const groups = new Map<string, BalanceReportGroup>();

  for (const balance of balances) {
    if (balance.scheduled_status === "Cancelled") continue;
    const outstandingMinor = moneyToMinorUnits(balance.outstanding_amount);
    const scheduledMinor = moneyToMinorUnits(balance.scheduled_amount);
    const paidMinor = moneyToMinorUnits(balance.paid_amount);
    if (outstandingMinor === null || scheduledMinor === null || paidMinor === null || outstandingMinor <= 0) continue;

    let daysOverdue = 0;
    if (mode === "overdue") {
      if (!balance.due_date || todayOrdinal === null) continue;
      const dueOrdinal = toDateOrdinal(balance.due_date);
      const isAdmissionFee = balance.sequence_number === 0;
      if (dueOrdinal === null || dueOrdinal > todayOrdinal
        || (dueOrdinal === todayOrdinal && !isAdmissionFee)) continue;
      daysOverdue = Math.max(0, todayOrdinal - dueOrdinal);
    }

    const student = studentsById.get(balance.student_id);
    if (!student) continue;
    let group = groups.get(student.id);
    if (!group) {
      group = {
        studentId: student.id,
        studentName: student.name || "Unnamed student",
        course: student.course || "Student fee",
        archived: student.archived_at !== null,
        installments: [],
        totalMinor: 0,
      };
      groups.set(student.id, group);
    }
    group.installments.push({
      id: balance.installment_id,
      number: balance.sequence_number,
      dueDate: balance.due_date ?? "",
      scheduledMinor,
      paidMinor,
      outstandingMinor,
      daysOverdue,
    });
    group.totalMinor += outstandingMinor;
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      installments: group.installments.sort((a, b) => {
        if (!a.dueDate) return b.dueDate ? 1 : a.number - b.number;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate) || a.number - b.number;
      }),
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

export function dateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
