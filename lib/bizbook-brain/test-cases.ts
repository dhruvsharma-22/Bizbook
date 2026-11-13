/**
 * BizBook Brain — Complete Test Suite
 *
 * Covers:
 * - Money calculations
 * - Installments and partial payments
 * - Advance receipts and allocations
 * - Refund calculations
 * - Reminder scheduling
 * - Salary calculations and validation
 * - Attendance services
 * - Salary payment services
 * - Accounting summaries
 * - Duplicate transaction IDs
 * - Accounting category validation
 * - Payment engine validation and verification
 * - Receipt generation and eligibility
 * - Payment-service integration and fee-receipt storage
 *
 * Run:
 * npx tsc --noEmit
 * npx tsx lib/bizbook-brain/test-cases.ts
 */
import { calculateOutstanding, toPaise } from "./money";
import { calculateStudentBalance } from "./balance-engine";
import {
  createExtendedFinancialReport,
  createFinancialReport,
} from "./report-engine";
import { createFeeInvoice } from "./invoice-engine";
import { normalizeStudentReceiptRecords } from "./receipt-adapter";
import {
  getInstallmentRemaining,
  applyInstallmentPayment,
  applyInstallmentAdvance,
} from "./installment-engine";
import {
  getReceiptAvailableAdvance,
  applyAllocationToReceipt,
} from "./advance-engine";
import { applyAdvancePayment } from "./advance-service";
import {
  getRefundableAmount,
  getReservedRefundAmount,
  createRefundRequest,
} from "./refund-engine";
import {
  createRefund,
  getRemainingRefundableAmount,
  updateRefundStatus,
} from "./refund-service";
import { BIZBOOK_REFUNDS_KEY } from "./storage-adapter";
import {
  BIZBOOK_EXPENSES_KEY,
  readExpenses,
  readStudentsStaff,
  saveStudentsStaff,
} from "./storage-adapter";
import {
  createPayment,
  recordOfflinePayment,
  verifyOnlinePayment,
  canApplyPayment,
  getPaymentAmountPaise,
} from "./payment-engine";
import { createPaymentReceipt } from "./receipt-engine";
import {
  createOnlinePayment,
  recordOfflinePaymentService,
  verifyOnlinePaymentService,
  getPaymentReceipt,
} from "./payment-service";
import {
  BIZBOOK_STORAGE_KEYS,
  readAdvancePayments,
  readFeeReceipts,
  readPaymentHistory,
  readPaymentRecords,
} from "./storage-adapter";
import { updateExpense } from "./expense-service";
import {
  toPublicTenantPaymentProviderConnection,
  validateProviderVerificationInput,
  validateTenantPaymentContext,
} from "./payment-provider";
import type { RefundRecord } from "./refund-engine";
import {
  getScheduledReminder,
  getLocalDateInTimeZone,
  hasReminderConsent,
  REMINDER_PLAN,
} from "./reminder-engine";
import { calculateSalary } from "./salary-engine";
import {
  calculateAccountingSummary,
  calculateMixedAccountingSummary,
} from "./accounting-engine";
import type { AccountingEntry } from "./accounting-engine";
import type {
  AdvancePayment,
  AttendanceData,
  FeeReceipt,
  PaymentRecord,
  SalaryCalculationInput,
  StaffMember,
  Student,
  StudentsStaffData,
} from "./types";
import {
  ATTENDANCE_STORAGE_KEY,
  SALARY_PAYMENTS_STORAGE_KEY,
  STUDENTS_STAFF_STORAGE_KEY,
} from "./constants";
import {
  markAttendance,
  updateAttendance,
  getAttendanceSummary,
} from "./attendance-service";
import {
  calculateStaffSalary,
  recordSalaryPayment,
  listSalaryPayments,
} from "./salary-service";
/* =========================================================
   MOCK STORAGE
========================================================= */
class MockStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}
const mockStorage = new MockStorage();
function enableServiceTestStorage(): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: mockStorage,
      dispatchEvent: () => true,
    },
  });
}
function resetServiceTestStorage(): void {
  mockStorage.clear();
  const staff: StaffMember = {
    id: "staff-test-1",
    name: "Test Staff",
    designation: "Teacher",
    monthlySalary: 30000,
    joiningDate: "2026-10-01",
    perDayLeaveCut: 1000,
    salaryCalculationMode: "AttendanceBased",
  };
  const data: StudentsStaffData = {
    students: [],
    staff: [staff],
  };
  mockStorage.setItem(
    STUDENTS_STAFF_STORAGE_KEY,
    JSON.stringify(data),
  );
  mockStorage.setItem(
    ATTENDANCE_STORAGE_KEY,
    JSON.stringify({}),
  );
  mockStorage.setItem(
    SALARY_PAYMENTS_STORAGE_KEY,
    JSON.stringify({}),
  );
}
function resetPaymentServiceTestStorage(
  student: Student = {
    id: "payment-service-student",
    name: "Payment Service Student",
    course: "Test Course",
    totalFee: 10000,
    installments: [],
  },
): void {
  enableServiceTestStorage();
  resetServiceTestStorage();
  const existing = JSON.parse(
    mockStorage.getItem(STUDENTS_STAFF_STORAGE_KEY) ??
      JSON.stringify({ students: [], staff: [] }),
  ) as StudentsStaffData;
  mockStorage.setItem(
    STUDENTS_STAFF_STORAGE_KEY,
    JSON.stringify({
      ...existing,
      students: [student],
    }),
  );
  mockStorage.setItem(
    BIZBOOK_STORAGE_KEYS.advancePayments,
    JSON.stringify([]),
  );
  mockStorage.setItem(
    BIZBOOK_STORAGE_KEYS.feeReceipts,
    JSON.stringify([]),
  );
  mockStorage.setItem(
    BIZBOOK_STORAGE_KEYS.paymentHistory,
    JSON.stringify([]),
  );
  mockStorage.setItem(
    BIZBOOK_STORAGE_KEYS.paymentRecords,
    JSON.stringify([]),
  );
}
/* =========================================================
   TEST RUNNER
========================================================= */
export interface TestCaseResult {
  name: string;
  passed: boolean;
  error?: string;
}
export function runBizBookTestCases(): TestCaseResult[] {
  const results: TestCaseResult[] = [];
  function test(
    name: string,
    callback: () => boolean,
  ): void {
    try {
      const passed = callback();
      results.push({
        name,
        passed,
        ...(passed
          ? {}
          : { error: "Expected result did not match." }),
      });
    } catch (error) {
      results.push({
        name,
        passed: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
  /* =======================================================
     MONEY TESTS
  ======================================================= */
  test("Rupees to paise", () => {
    return toPaise(12.34) === 1234;
  });
  test("Outstanding fee", () => {
    return calculateOutstanding(15000, 5000) === 10000;
  });
  /* =======================================================
     INSTALLMENT TESTS
  ======================================================= */
  test("Legacy installment remaining", () => {
    return (
      getInstallmentRemaining({
        id: "legacy-test",
        amount: 5000,
        status: "Pending",
      }) === 5000
    );
  });
  test("Repeated partial payments", () => {
    const original = {
      id: "legacy-partial",
      amount: 5000,
      status: "Pending" as const,
    };
    const first = applyInstallmentPayment(original, 2000);
    const second = applyInstallmentPayment(first, 1000);
    return (
      getInstallmentRemaining(first) === 3000 &&
      getInstallmentRemaining(second) === 2000
    );
  });
  test("Legacy Paid installment with no tracking is not collectable", () => {
    const paid = {
      id: "legacy-paid-no-tracking",
      amount: 5000,
      status: "Paid" as const,
    };
    let rejected = false;
    try {
      applyInstallmentPayment(paid, 100);
    } catch {
      rejected = true;
    }
    return getInstallmentRemaining(paid) === 0 && rejected;
  });
  test("Legacy installment payment aliases share the Brain balance", () => {
    const installment = {
      id: "legacy-alias-installment",
      amount: 5000,
      status: "Overdue" as const,
      amountPaid: 1000,
      advanceAppliedAmount: 500,
      payments: [
        { amount: 1500, status: "Paid" },
        { amount: 900, status: "Failed" },
      ],
    };
    const updated = applyInstallmentPayment(installment, 500);
    return (
      getInstallmentRemaining(installment) === 3000 &&
      updated.paidAmount === 2000 &&
      getInstallmentRemaining(updated) === 2500
    );
  });
  test("Ordinary partial payment preserves advance allocation and remaining balance", () => {
    const installment = {
      id: "partial-after-advance",
      amount: 5000,
      scheduledAmount: 5000,
      paidAmount: 1000,
      advanceAppliedAmount: 1500,
      status: "Partially Paid" as const,
      legacyMarker: "keep-me",
    };
    const updated = applyInstallmentPayment(installment, 1000);
    return (
      getInstallmentRemaining(installment) === 2500 &&
      getInstallmentRemaining(updated) === 1500 &&
      updated.paidAmount === 2000 &&
      updated.advanceAppliedAmount === 1500 &&
      updated.status === "Partially Paid" &&
      (updated as typeof updated & { legacyMarker?: string }).legacyMarker ===
        "keep-me"
    );
  });
  test("Partial payment retains overdue status", () => {
    const installment = {
      id: "tracked-overdue-partial",
      amount: 5000,
      scheduledAmount: 5000,
      paidAmount: 0,
      advanceAppliedAmount: 0,
      status: "Overdue" as const,
    };
    const updated = applyInstallmentPayment(installment, 1000);
    return (
      updated.status === "Overdue" &&
      getInstallmentRemaining(updated) === 4000
    );
  });
  test("Advance allocation is tracked separately", () => {
    const original = {
      id: "tracked-advance",
      amount: 5000,
      scheduledAmount: 5000,
      paidAmount: 1000,
      advanceAppliedAmount: 0,
      status: "Pending" as const,
    };
    const updated = applyInstallmentAdvance(original, 1500);
    return (
      getInstallmentRemaining(updated) === 2500 &&
      updated.paidAmount === 1000 &&
      updated.advanceAppliedAmount === 1500
    );
  });
  test("Partial payment preserves overdue status", () => {
    const original = {
      id: "legacy-overdue",
      amount: 5000,
      status: "Overdue" as const,
    };
    const updated = applyInstallmentPayment(original, 1000);
    return (
      getInstallmentRemaining(updated) === 4000 &&
      updated.status === "Overdue"
    );
  });
  test("Legacy advance allocation reduces outstanding balance", () => {
    const original = {
      id: "legacy-advance",
      amount: 5000,
      status: "Pending" as const,
    };
    const updated = applyInstallmentAdvance(original, 2000);
    return (
      getInstallmentRemaining(updated) === 3000 &&
      updated.advanceAppliedAmount === 2000 &&
      updated.paidAmount === 0 &&
      updated.scheduledAmount === 5000
    );
  });
  test("Advance allocation greater than outstanding is rejected", () => {
    try {
      applyInstallmentAdvance(
        {
          id: "legacy-overallocation",
          amount: 5000,
          status: "Pending" as const,
        },
        6000,
      );
      return false;
    } catch {
      return true;
    }
  });
  /* =======================================================
     ADVANCE RECEIPT TESTS
  ======================================================= */
  function createTestReceipt(
    overrides: Partial<AdvancePayment> = {},
  ): AdvancePayment {
    return {
      id: "advance-test-1",
      studentId: "student-1",
      studentName: "Test Student",
      course: "Test Course",
      amount: 5000,
      paymentDate: "2026-10-12",
      method: "UPI",
      createdAt: "2026-10-12T10:00:00.000Z",
      appliedAmount: 0,
      appliedTo: [],
      ...overrides,
    };
  }
  test("Full advance amount is available initially", () => {
    return getReceiptAvailableAdvance(createTestReceipt()) === 5000;
  });
  test("Available advance decreases after allocation", () => {
    const updated = applyAllocationToReceipt(
      createTestReceipt(),
      {
        installmentIndex: 0,
        amount: 2000,
        appliedAt: "2026-10-12T10:00:00.000Z",
      },
    );
    return (
      getReceiptAvailableAdvance(updated) === 3000 &&
      updated.appliedAmount === 2000 &&
      updated.appliedTo?.length === 1 &&
      updated.appliedTo[0]?.amount === 2000
    );
  });
  test("Allocation exceeding available advance is rejected", () => {
    try {
      applyAllocationToReceipt(
        createTestReceipt({ appliedAmount: 2000 }),
        {
          installmentIndex: 0,
          amount: 4000,
          appliedAt: "2026-10-12T10:00:00.000Z",
        },
      );
      return false;
    } catch {
      return true;
    }
  });
  test("Advance receipt remains unchanged after allocation", () => {
    const receipt = createTestReceipt();
    applyAllocationToReceipt(receipt, {
      installmentIndex: 0,
      amount: 2000,
      appliedAt: "2026-10-12T10:00:00.000Z",
    });
    return (
      receipt.appliedAmount === 0 &&
      receipt.appliedTo?.length === 0
    );
  });
  test("Available advance cannot be negative", () => {
    try {
      getReceiptAvailableAdvance(
        createTestReceipt({
          amount: 5000,
          appliedAmount: 6000,
        }),
      );
      return false;
    } catch {
      return true;
    }
  });
  /* =======================================================
     REFUND TESTS
  ======================================================= */
  test("Refundable amount", () => {
    const payment = {
      id: "payment-test",
      studentId: "student-test",
      amount: 5000,
      method: "UPI",
      mode: "Manual",
      status: "Paid",
      createdAt: "2026-10-12T10:00:00.000Z",
      updatedAt: "2026-10-12T10:00:00.000Z",
    } as PaymentRecord;
    const refunds: RefundRecord[] = [];
    return getRefundableAmount(payment, refunds) === 5000;
  });
  test("Pending refund reserves refundable balance", () => {
    const payment = {
      id: "refund-reserve-payment",
      studentId: "student-test",
      amount: 5000,
      method: "UPI",
      mode: "Manual",
      status: "Paid",
      createdAt: "2026-10-12T10:00:00.000Z",
      updatedAt: "2026-10-12T10:00:00.000Z",
    } as PaymentRecord;

    const refund = createRefundRequest({
      id: "refund-reserve-1",
      payment,
      amount: 1500,
      reason: "Duplicate payment",
      requestedBy: "staff-test-1",
      previousRefunds: [],
    });

    return (
      refund.status === "Pending" &&
      getReservedRefundAmount(payment.id, [refund]) === 1500 &&
      getRefundableAmount(payment, [refund]) === 3500
    );
  });

  test("Refund request exceeding remaining balance is rejected", () => {
    const payment = {
      id: "refund-overflow-payment",
      studentId: "student-test",
      amount: 5000,
      method: "UPI",
      mode: "Manual",
      status: "Paid",
      createdAt: "2026-10-12T10:00:00.000Z",
      updatedAt: "2026-10-12T10:00:00.000Z",
    } as PaymentRecord;

    try {
      createRefundRequest({
        id: "refund-overflow-1",
        payment,
        amount: 5001,
        reason: "Over refund test",
        requestedBy: "staff-test-1",
        previousRefunds: [],
      });
      return false;
    } catch {
      return true;
    }
  });

  test("Failed and cancelled refunds do not reserve balance", () => {
    const refunds: RefundRecord[] = [
      {
        id: "refund-failed-1",
        paymentId: "refund-status-payment",
        studentId: "student-test",
        amount: 1000,
        status: "Failed",
        reason: "Provider rejected",
        mode: "Manual",
        requestedBy: "staff-test-1",
        createdAt: "2026-10-12T10:00:00.000Z",
        updatedAt: "2026-10-12T10:00:00.000Z",
      },
      {
        id: "refund-cancelled-1",
        paymentId: "refund-status-payment",
        studentId: "student-test",
        amount: 500,
        status: "Cancelled",
        reason: "Cancelled by staff",
        mode: "Manual",
        requestedBy: "staff-test-1",
        createdAt: "2026-10-12T10:00:00.000Z",
        updatedAt: "2026-10-12T10:00:00.000Z",
      },
    ];

    return getReservedRefundAmount("refund-status-payment", refunds) === 0;
  });

  test("Online refund reference cannot mark a refund completed", () => {
    enableServiceTestStorage();
    mockStorage.clear();

    const payment = {
      id: "online-refund-confirmation-payment",
      studentId: "student-test",
      amount: 5000,
      method: "Online",
      mode: "Online",
      status: "Paid",
      createdAt: "2026-10-12T10:00:00.000Z",
      updatedAt: "2026-10-12T10:00:00.000Z",
    } as PaymentRecord;

    const refund = createRefund({
      id: "online-refund-confirmation-1",
      payment,
      amount: 1200,
      reason: "Duplicate online payment",
      requestedBy: "staff-test-1",
      previousRefunds: [],
    });

    let rejected = false;
    try {
      updateRefundStatus(
        refund.id,
        "Completed",
        "provider-refund-reference",
      );
    } catch {
      rejected = true;
    }

    const stored = JSON.parse(
      mockStorage.getItem(BIZBOOK_REFUNDS_KEY) ?? "[]",
    ) as RefundRecord[];

    return (
      rejected &&
      stored[0]?.status === "Pending" &&
      getRemainingRefundableAmount(payment) === 3800
    );
  });
  /* =======================================================
     REMINDER TESTS
  ======================================================= */
  test("Five reminders configured", () => {
    return REMINDER_PLAN.length === 5;
  });
  test("Automated reminder channels require explicit opt-in", () => {
    return !hasReminderConsent("Email", {}) &&
      !hasReminderConsent("WhatsApp", {}) &&
      !hasReminderConsent("Email", { emailOptIn: false, whatsappOptIn: true }) &&
      hasReminderConsent("Email", { emailOptIn: true }) &&
      hasReminderConsent("WhatsApp", { whatsappOptIn: true });
  });
  test("First reminder is email", () => {
    return (
      getScheduledReminder("2026-10-15", "2026-10-12")
        ?.channel === "Email"
    );
  });
  test("Third reminder is WhatsApp", () => {
    return (
      getScheduledReminder("2026-10-15", "2026-10-14")
        ?.channel === "WhatsApp"
    );
  });
  test("No reminder after final scheduled day", () => {
    return (
      getScheduledReminder("2026-10-15", "2026-10-17") === null
    );
  });
  test("Reminder calendar date follows the institute time zone", () => {
    return getLocalDateInTimeZone(
      new Date("2026-10-12T20:00:00.000Z"),
      "Asia/Kolkata",
    ) === "2026-10-13";
  });
  /* =======================================================
     SALARY ENGINE TESTS
  ======================================================= */
  function createSalaryInput(
    overrides: Partial<SalaryCalculationInput> = {},
  ): SalaryCalculationInput {
    return {
      staffId: "staff-test-1",
      month: "2026-10",
      monthlySalary: 30000,
      mode: "AttendanceBased",
      perDayLeaveCut: 500,
      attendance: {},
      joiningDate: "2026-01-01",
      manualAdjustment: 0,
      ...overrides,
    };
  }
  test("Fixed salary has no attendance deductions", () => {
    const attendance: AttendanceData = {
      "staff-test-1__2026-10-05": "Absent",
      "staff-test-1__2026-10-10": "Leave",
    };
    const result = calculateSalary(
      createSalaryInput({ mode: "Fixed", attendance }),
    );
    return (
      result.payableSalary === 30000 &&
      result.deductionDays === 0 &&
      result.attendanceDeduction === 0
    );
  });
  test("Attendance-based salary deducts absent days", () => {
    const attendance: AttendanceData = {
      "staff-test-1__2026-10-05": "Absent",
      "staff-test-1__2026-10-10": "Absent",
    };
    const result = calculateSalary(createSalaryInput({ attendance }));
    return (
      result.deductionDays === 2 &&
      result.attendanceDeduction === 1000 &&
      result.payableSalary === 29000
    );
  });
  test("Attendance-based salary deducts Leave days", () => {
    const attendance: AttendanceData = {
      "staff-test-1__2026-10-05": "Leave",
    };
    const result = calculateSalary(createSalaryInput({ attendance }));
    return (
      result.deductionDays === 1 &&
      result.attendanceDeduction === 500 &&
      result.payableSalary === 29500
    );
  });
  test("Present and Holiday do not cause deductions", () => {
    const attendance: AttendanceData = {
      "staff-test-1__2026-10-05": "Present",
      "staff-test-1__2026-10-06": "Holiday",
    };
    const result = calculateSalary(createSalaryInput({ attendance }));
    return (
      result.deductionDays === 0 &&
      result.attendanceDeduction === 0 &&
      result.payableSalary === 30000
    );
  });
  test("Joining date excludes earlier absence records", () => {
    const attendance: AttendanceData = {
      "staff-test-1__2026-10-10": "Absent",
      "staff-test-1__2026-10-15": "Absent",
      "staff-test-1__2026-10-16": "Absent",
    };
    const result = calculateSalary(
      createSalaryInput({
        joiningDate: "2026-10-15",
        attendance,
      }),
    );
    return (
      result.deductionDays === 2 &&
      result.attendanceDeduction === 1000 &&
      result.payableSalary === 29000
    );
  });
  test("Joining date is included while the previous day is excluded", () => {
    const attendance: AttendanceData = {
      "staff-test-1__2026-10-14": "Absent",
      "staff-test-1__2026-10-15": "Leave",
    };
    const result = calculateSalary(
      createSalaryInput({
        joiningDate: "2026-10-15",
        attendance,
      }),
    );
    return result.deductionDays === 1 && result.payableSalary === 29500;
  });
  test("Positive manual adjustment increases salary", () => {
    const result = calculateSalary(
      createSalaryInput({ manualAdjustment: 1000 }),
    );
    return (
      result.manualAdjustment === 1000 &&
      result.payableSalary === 31000
    );
  });
  test("Negative manual adjustment reduces salary", () => {
    const result = calculateSalary(
      createSalaryInput({ manualAdjustment: -1000 }),
    );
    return (
      result.manualAdjustment === -1000 &&
      result.payableSalary === 29000
    );
  });
  test("Payable salary cannot be negative", () => {
    const attendance: AttendanceData = {};
    for (let day = 1; day <= 31; day++) {
      const date = `2026-10-${String(day).padStart(2, "0")}`;
      attendance[`staff-test-1__${date}`] = "Absent";
    }
    const result = calculateSalary(
      createSalaryInput({
        monthlySalary: 1000,
        perDayLeaveCut: 500,
        attendance,
        manualAdjustment: -1000,
      }),
    );
    return result.payableSalary === 0;
  });
  test("Invalid payroll month is rejected", () => {
    try {
      calculateSalary(createSalaryInput({ month: "2026-13" }));
      return false;
    } catch {
      return true;
    }
  });
  test("Invalid attendance status is rejected", () => {
    const attendance = {
      "staff-test-1__2026-10-05": "Unknown",
    } as unknown as AttendanceData;
    try {
      calculateSalary(createSalaryInput({ attendance }));
      return false;
    } catch {
      return true;
    }
  });
  /* =======================================================
     ATTENDANCE SERVICE TESTS
  ======================================================= */
  test("Attendance service saves a record", () => {
    enableServiceTestStorage();
    resetServiceTestStorage();
    markAttendance({
      staffId: "staff-test-1",
      date: "2026-10-05",
      status: "Present",
    });
    const saved = JSON.parse(
      mockStorage.getItem(ATTENDANCE_STORAGE_KEY) ?? "{}",
    );
    return saved["staff-test-1__2026-10-05"] === "Present";
  });
  test("Attendance service rejects duplicate records", () => {
    enableServiceTestStorage();
    resetServiceTestStorage();
    const input = {
      staffId: "staff-test-1",
      date: "2026-10-05",
      status: "Present" as const,
    };
    markAttendance(input);
    try {
      markAttendance(input);
      return false;
    } catch {
      return true;
    }
  });
  test("Attendance service updates existing records", () => {
    enableServiceTestStorage();
    resetServiceTestStorage();
    markAttendance({
      staffId: "staff-test-1",
      date: "2026-10-05",
      status: "Present",
    });
    updateAttendance({
      staffId: "staff-test-1",
      date: "2026-10-05",
      status: "Absent",
    });
    const saved = JSON.parse(
      mockStorage.getItem(ATTENDANCE_STORAGE_KEY) ?? "{}",
    );
    return saved["staff-test-1__2026-10-05"] === "Absent";
  });
  test("Attendance summary counts recorded statuses", () => {
    enableServiceTestStorage();
    resetServiceTestStorage();
    markAttendance({
      staffId: "staff-test-1",
      date: "2026-10-05",
      status: "Present",
    });
    markAttendance({
      staffId: "staff-test-1",
      date: "2026-10-06",
      status: "Absent",
    });
    markAttendance({
      staffId: "staff-test-1",
      date: "2026-10-07",
      status: "Leave",
    });
    markAttendance({
      staffId: "staff-test-1",
      date: "2026-10-08",
      status: "Holiday",
    });
    const summary = getAttendanceSummary(
      "staff-test-1",
      "2026-10-01",
      "2026-10-31",
    );
    return (
      summary.presentDays === 1 &&
      summary.absentDays === 1 &&
      summary.leaveDays === 1 &&
      summary.holidayDays === 1 &&
      summary.recordedDays === 4
    );
  });
  /* =======================================================
     SALARY SERVICE TESTS
  ======================================================= */
  test("Salary service uses saved staff and attendance", () => {
    enableServiceTestStorage();
    resetServiceTestStorage();
    markAttendance({
      staffId: "staff-test-1",
      date: "2026-10-05",
      status: "Absent",
    });
    const result = calculateStaffSalary("staff-test-1", "2026-10");
    return (
      result.monthlySalary === 30000 &&
      result.attendanceDeduction === 1000 &&
      result.payableSalary === 29000
    );
  });
  test("Salary service records a monthly payment", () => {
    enableServiceTestStorage();
    resetServiceTestStorage();
    recordSalaryPayment({
      staffId: "staff-test-1",
      month: "2026-10",
      amount: 30000,
      paidAt: "2026-10-31",
      method: "Bank Transfer",
    });
    const payments = listSalaryPayments({
      staffId: "staff-test-1",
      month: "2026-10",
    });
    return (
      payments.length === 1 &&
      payments[0].amount === 30000 &&
      payments[0].status === "Paid" &&
      readPaymentHistory().length === 0
    );
  });
  test("Salary service rejects duplicate monthly payments", () => {
    enableServiceTestStorage();
    resetServiceTestStorage();
    const input = {
      staffId: "staff-test-1",
      month: "2026-10",
      amount: 30000,
      paidAt: "2026-10-31",
      method: "Bank Transfer" as const,
    };
    recordSalaryPayment(input);
    try {
      recordSalaryPayment(input);
      return false;
    } catch {
      return true;
    }
  });
  test("Salary service filters payments by month", () => {
    enableServiceTestStorage();
    resetServiceTestStorage();
    recordSalaryPayment({
      staffId: "staff-test-1",
      month: "2026-10",
      amount: 30000,
      paidAt: "2026-10-31",
      method: "Bank Transfer",
    });
    return (
      listSalaryPayments({ month: "2026-10" }).length === 1 &&
      listSalaryPayments({ month: "2026-11" }).length === 0
    );
  });
  test("Student storage preserves nested legacy shape and unknown fields", () => {
    enableServiceTestStorage();
    const legacy = {
      rootVersion: "legacy-v2",
      rootUnknown: { keep: true },
      data: {
        students: [{ id: "legacy-student", name: "Legacy Student", extra: "keep-student" }],
        staff: [],
        nestedUnknown: "keep-nested",
      },
    };
    mockStorage.setItem(STUDENTS_STAFF_STORAGE_KEY, JSON.stringify(legacy));
    const normalized = readStudentsStaff();
    saveStudentsStaff({
      ...normalized,
      students: [
        ...normalized.students,
        { id: "second-student", name: "Second Student" },
      ],
    });
    const saved = JSON.parse(
      mockStorage.getItem(STUDENTS_STAFF_STORAGE_KEY) ?? "null",
    ) as typeof legacy;
    return (
      Array.isArray(saved.data.students) &&
      saved.data.students.length === 2 &&
      saved.data.students[0]?.extra === "keep-student" &&
      saved.data.nestedUnknown === "keep-nested" &&
      saved.rootVersion === "legacy-v2" &&
      saved.rootUnknown.keep === true
    );
  });
  test("Editing a student keeps unknown fields, email, and reminder preferences", () => {
    enableServiceTestStorage();
    mockStorage.setItem(STUDENTS_STAFF_STORAGE_KEY, JSON.stringify({
      students: [{ id: "email-edit-student", name: "Before", unknownMarker: "keep" }],
      staff: [],
    }));
    const normalized = readStudentsStaff();
    const existing = normalized.students[0];
    if (!existing) return false;
    saveStudentsStaff({
      ...normalized,
      students: [{
        ...existing,
        name: "After",
        parentEmail: "parent@example.test",
        parentEmailOptIn: true,
        whatsappOptIn: false,
      }],
    });
    const saved = readStudentsStaff().students[0];
    return saved?.name === "After" &&
      saved.parentEmail === "parent@example.test" &&
      saved.parentEmailOptIn === true &&
      saved.whatsappOptIn === false &&
      saved.unknownMarker === "keep";
  });
  test("Student storage keeps the legacy root-array format", () => {
    enableServiceTestStorage();
    mockStorage.setItem(
      STUDENTS_STAFF_STORAGE_KEY,
      JSON.stringify([{ id: "array-student", name: "Array Student" }]),
    );
    const normalized = readStudentsStaff();
    saveStudentsStaff({
      ...normalized,
      students: [
        ...normalized.students,
        { id: "array-student-2", name: "Second Array Student" },
      ],
    });
    const saved = JSON.parse(
      mockStorage.getItem(STUDENTS_STAFF_STORAGE_KEY) ?? "null",
    ) as unknown;
    return Array.isArray(saved) && saved.length === 2;
  });
  test("Advance allocation preserves nested storage and counts the receipt once", () => {
    enableServiceTestStorage();
    const student: Student = {
      id: "nested-advance-student",
      name: "Nested Advance Student",
      totalFee: 1000,
      installments: [{
        id: "nested-advance-installment",
        amount: 1000,
        status: "Pending",
      }],
    };
    mockStorage.setItem(
      STUDENTS_STAFF_STORAGE_KEY,
      JSON.stringify({
        rootMarker: "preserve-root",
        data: {
          students: [student],
          staff: [],
          nestedMarker: "preserve-nested",
        },
      }),
    );
    mockStorage.setItem(
      BIZBOOK_STORAGE_KEYS.advancePayments,
      JSON.stringify([{
        id: "nested-advance-receipt",
        studentId: student.id,
        studentName: student.name,
        amount: 500,
        paymentDate: "2026-10-12",
        method: "Cash",
        createdAt: "2026-10-12T10:00:00.000Z",
        appliedAmount: 0,
        appliedTo: [],
      } satisfies AdvancePayment]),
    );

    const result = applyAdvancePayment({
      receiptId: "nested-advance-receipt",
      studentId: student.id,
      installmentIndex: 0,
      amount: 300,
    });
    const savedStorage = JSON.parse(
      mockStorage.getItem(STUDENTS_STAFF_STORAGE_KEY) ?? "null",
    ) as { rootMarker: string; data: { students: Student[]; nestedMarker: string } };
    const savedStudent = savedStorage.data.students[0];
    if (!savedStudent) return false;
    const balance = calculateStudentBalance(savedStudent, [result.receipt]);

    return (
      savedStorage.rootMarker === "preserve-root" &&
      savedStorage.data.nestedMarker === "preserve-nested" &&
      savedStudent?.installments?.[0]?.status === "Partially Paid" &&
      result.receipt.amount === 500 &&
      result.receipt.appliedAmount === 300 &&
      balance.totalReceived === 500 &&
      balance.totalOutstanding === 700 &&
      balance.advanceAvailable === 200
    );
  });
  test("Student-only array storage refuses to drop newly added staff", () => {
    enableServiceTestStorage();
    mockStorage.setItem(
      STUDENTS_STAFF_STORAGE_KEY,
      JSON.stringify([{ id: "array-only-student", name: "Array Student" }]),
    );
    const normalized = readStudentsStaff();
    let rejected = false;
    try {
      saveStudentsStaff({
        ...normalized,
        staff: [{ id: "new-staff", name: "New Staff" }],
      });
    } catch {
      rejected = true;
    }
    const saved = JSON.parse(
      mockStorage.getItem(STUDENTS_STAFF_STORAGE_KEY) ?? "null",
    ) as unknown;
    return rejected && Array.isArray(saved) && saved.length === 1;
  });
  test("Expense updates preserve unknown legacy fields", () => {
    enableServiceTestStorage();
    resetServiceTestStorage();
    mockStorage.setItem(
      BIZBOOK_EXPENSES_KEY,
      JSON.stringify([{
        id: "legacy-expense-1",
        title: "Rent",
        category: "Rent",
        amount: 1000,
        date: "2026-10-01",
        method: "Cash",
        createdAt: "2026-10-01T10:00:00.000Z",
        importedLedgerCode: "OFFICE-01",
      }]),
    );
    updateExpense("legacy-expense-1", {
      title: "October rent",
      category: "Rent",
      amount: 1200,
      date: "2026-10-02",
      method: "UPI",
    });
    const saved = JSON.parse(
      mockStorage.getItem(BIZBOOK_EXPENSES_KEY) ?? "[]",
    ) as Array<Record<string, unknown>>;
    return (
      readExpenses().length === 1 &&
      saved[0]?.amount === 1200 &&
      saved[0]?.importedLedgerCode === "OFFICE-01"
    );
  });
  /* =======================================================
     ACCOUNTING ENGINE TESTS
  ======================================================= */
  function createAccountingEntry(
    overrides: Partial<AccountingEntry> = {},
  ): AccountingEntry {
    return {
      id: "accounting-test-1",
      amount: 1000,
      type: "collection",
      status: "completed",
      date: "2026-10-12",
      ...overrides,
    };
  }
  test("Accounting calculates collections, expenses, and refunds", () => {
    const entries: AccountingEntry[] = [
      createAccountingEntry({
        id: "fee-1",
        amount: 10000,
        category: "student_fee",
      }),
      createAccountingEntry({
        id: "expense-1",
        amount: 2000,
        type: "expense",
        category: "business_expense",
      }),
      createAccountingEntry({
        id: "refund-1",
        amount: 1000,
        type: "refund",
        category: "refund",
      }),
    ];
    const result = calculateAccountingSummary(entries);
    return (
      result.totalCollections === 10000 &&
      result.totalExpenses === 2000 &&
      result.totalRefunds === 1000 &&
      result.netProfit === 7000 &&
      result.pendingCollections === 0
    );
  });
  test("Pending and cancelled transactions are excluded from completed totals", () => {
    const entries: AccountingEntry[] = [
      createAccountingEntry({
        id: "completed",
        amount: 5000,
      }),
      createAccountingEntry({
        id: "pending",
        amount: 2000,
        status: "pending",
      }),
      createAccountingEntry({
        id: "cancelled",
        amount: 3000,
        status: "cancelled",
      }),
    ];
    const result = calculateAccountingSummary(entries);
    return (
      result.totalCollections === 5000 &&
      result.pendingCollections === 2000 &&
      result.netProfit === 5000
    );
  });
  test("Advance receipt is counted once, not again as an allocation", () => {
    const entries: AccountingEntry[] = [
      createAccountingEntry({
        id: "advance-receipt-1",
        amount: 5000,
        category: "student_advance",
      }),
    ];
    const result = calculateMixedAccountingSummary(entries);
    return (
      result.totalCollections === 5000 &&
      result.studentAdvanceReceipts === 5000 &&
      result.netProfit === 5000
    );
  });
  test("Salary is included in total expenses exactly once", () => {
    const entries: AccountingEntry[] = [
      createAccountingEntry({
        id: "collection-1",
        amount: 20000,
        category: "student_fee",
      }),
      createAccountingEntry({
        id: "salary-1",
        amount: 5000,
        type: "expense",
        category: "salary",
      }),
    ];
    const result = calculateMixedAccountingSummary(entries);
    return (
      result.totalCollections === 20000 &&
      result.totalExpenses === 5000 &&
      result.salaryExpenses === 5000 &&
      result.businessExpenses === 0 &&
      result.netProfit === 15000
    );
  });
  test("BizBook subscription revenue is reported separately", () => {
    const entries: AccountingEntry[] = [
      createAccountingEntry({
        id: "coaching-fee-1",
        amount: 10000,
        category: "student_fee",
        coachingId: "coaching-1",
      }),
      createAccountingEntry({
        id: "subscription-1",
        amount: 500,
        category: "bizbook_subscription",
      }),
    ];
    const result = calculateMixedAccountingSummary(entries);
    return (
      result.totalCollections === 10500 &&
      result.studentFeeCollections === 10000 &&
      result.bizbookSubscriptionRevenue === 500
    );
  });
  test("Extended report separates subscription income and counts mirrored expenses once", () => {
    const student: Student = {
      id: "extended-report-student",
      name: "Extended Report Student",
      totalFee: 10000,
      installments: [],
    };
    const receipt: FeeReceipt = {
      id: "extended-report-fee",
      paymentRecordId: "extended-report-fee",
      studentId: student.id,
      studentName: student.name,
      amount: 7000,
      paymentDate: "2026-10-12",
      method: "UPI",
      createdAt: "2026-10-12T10:00:00.000Z",
    };
    const result = createExtendedFinancialReport({
      students: [student],
      receipts: [receipt],
      paymentHistory: [
        {
          id: "salary-history-1",
          type: "Salary",
          personId: "staff-1",
          personName: "Staff One",
          description: "October salary",
          amount: 1000,
          paidAt: "2026-10-12T11:00:00.000Z",
        },
        {
          id: "expense-history-1",
          type: "Expense",
          personId: "business",
          personName: "Business Expense",
          description: "Rent",
          amount: 2000,
          paidAt: "2026-10-12T12:00:00.000Z",
        },
      ],
      expenses: [{ id: "expense-history-1", amount: 2000 }],
      refunds: [{ id: "pending-refund-1", amount: 500, status: "Pending" }],
      subscriptionIncome: [{ id: "subscription-report-1", amount: 500, status: "Paid" }],
    });
    return (
      result.totalReceived === 7000 &&
      result.totalExpenses === 3000 &&
      result.totalRefunds === 0 &&
      result.bizbookSubscriptionIncome === 500 &&
      result.coachingNetCashPosition === 4000 &&
      result.combinedNetCashPosition === 4500
    );
  });
  test("Reports reject repeated salary history IDs without deduplicating partial-payment references", () => {
    const salary = {
      id: "salary-source-1",
      type: "Salary" as const,
      personId: "staff-report-1",
      personName: "Staff One",
      description: "October salary",
      amount: 1000,
      paidAt: "2026-10-12T10:00:00.000Z",
    };
    try {
      createFinancialReport([], [], [salary, { ...salary }]);
      return false;
    } catch {
      // Same real transaction IDs are rejected; distinct partials may
      // still share a bank/reference string because IDs are the identity.
      const partialOne = { ...salary, id: "partial-1", type: "Fee" as const, amount: 400 };
      const partialTwo = { ...salary, id: "partial-2", type: "Fee" as const, amount: 600 };
      return createFinancialReport([], [], [partialOne, partialTwo]).totalExpenses === 0;
    }
  });
  test("Duplicate accounting transaction IDs are rejected", () => {
    const entries: AccountingEntry[] = [
      createAccountingEntry({
        id: "duplicate-1",
        amount: 1000,
      }),
      createAccountingEntry({
        id: "duplicate-1",
        amount: 2000,
      }),
    ];
    try {
      calculateAccountingSummary(entries);
      return false;
    } catch {
      return true;
    }
  });
  test("Invalid accounting category is rejected", () => {
    const invalidEntry = {
      ...createAccountingEntry({
        id: "invalid-category-1",
      }),
      category: "unknown_category",
    } as unknown as AccountingEntry;
    try {
      calculateAccountingSummary([invalidEntry]);
      return false;
    } catch {
      return true;
    }
  });
  test("Salary category cannot be used for a collection", () => {
    const invalidEntry = createAccountingEntry({
      id: "invalid-salary-1",
      type: "collection",
      category: "salary",
    });
    try {
      calculateAccountingSummary([invalidEntry]);
      return false;
    } catch {
      return true;
    }
  });
  test("Negative accounting amounts are rejected", () => {
    const entry = createAccountingEntry({
      id: "negative-amount-1",
      amount: -100,
    });
    try {
      calculateAccountingSummary([entry]);
      return false;
    } catch {
      return true;
    }
  });
  test("Cancelled refunds are excluded from refund totals", () => {
    const entries: AccountingEntry[] = [
      createAccountingEntry({
        id: "completed-refund",
        amount: 500,
        type: "refund",
        category: "refund",
      }),
      createAccountingEntry({
        id: "cancelled-refund",
        amount: 300,
        type: "refund",
        category: "refund",
        status: "cancelled",
      }),
    ];
    const result = calculateAccountingSummary(entries);
    return (
      result.totalRefunds === 500 &&
      result.netProfit === -500
    );
  });
  test("Advance allocation does not create a second accounting inflow", () => {
    // Only the original receipt belongs in accounting.
    // Allocation changes balances, not total collections.
    const entries: AccountingEntry[] = [
      createAccountingEntry({
        id: "advance-receipt-allocation-test",
        amount: 5000,
        category: "student_advance",
        referenceId: "advance-source-1",
      }),
    ];
    const result = calculateMixedAccountingSummary(entries);
    return (
      result.totalCollections === 5000 &&
      result.studentAdvanceReceipts === 5000 &&
      result.netProfit === 5000
    );
  });
  test("A completed refund reduces net profit exactly once", () => {
    const entries: AccountingEntry[] = [
      createAccountingEntry({
        id: "refund-once-fee",
        amount: 5000,
        category: "student_fee",
        referenceId: "fee-source-1",
      }),
      createAccountingEntry({
        id: "refund-once-record",
        amount: 1000,
        type: "refund",
        category: "refund",
        referenceId: "fee-source-1",
      }),
    ];
    const result = calculateAccountingSummary(entries);
    return (
      result.totalCollections === 5000 &&
      result.totalRefunds === 1000 &&
      result.netProfit === 4000
    );
  });
  test("Distinct partial payments sharing a reference are both counted", () => {
    const entries: AccountingEntry[] = [
      createAccountingEntry({
        id: "partial-payment-1",
        amount: 2000,
        category: "student_fee",
        referenceId: "student-installment-1",
      }),
      createAccountingEntry({
        id: "partial-payment-2",
        amount: 3000,
        category: "student_fee",
        referenceId: "student-installment-1",
      }),
    ];
    const result = calculateMixedAccountingSummary(entries);
    return (
      result.totalCollections === 5000 &&
      result.studentFeeCollections === 5000
    );
  });
  /* =======================================================
     PAYMENT ENGINE TESTS
  ======================================================= */
  test("Provider context rejects a coaching ID mismatch", () => {
    try {
      validateTenantPaymentContext({
        coachingId: "coaching-a",
        connectionId: "connection-a",
        provider: "razorpay",
        mode: "test",
      }, "coaching-b");
      return false;
    } catch {
      return true;
    }
  });
  test("Provider verification rejects a currency mismatch", () => {
    try {
      validateProviderVerificationInput({
        orderId: "order-1",
        paymentId: "payment-1",
        providerPaymentId: "provider-payment-1",
        amount: 1000,
        currency: "USD" as "INR",
      });
      return false;
    } catch {
      return true;
    }
  });
  test("Public provider connection view omits credential references", () => {
    const view = toPublicTenantPaymentProviderConnection({
      id: "connection-public-test",
      coachingId: "coaching-public-test",
      provider: "cashfree",
      status: "connected",
      mode: "test",
      credentialSecretReference: "vault-reference-only",
      configVersion: 1,
      createdAt: "2026-10-12T10:00:00.000Z",
      updatedAt: "2026-10-12T10:00:00.000Z",
    });
    return (
      view.id === "connection-public-test" &&
      !("credentialSecretReference" in view)
    );
  });
  test("Online payment starts as Pending", () => {
    const payment = createPayment({
      id: "online-pending-test",
      studentId: "student-1",
      amount: 2500,
      method: "Online",
      mode: "Online",
      createdAt: "2026-10-12T10:00:00.000Z",
    });
    return (
      payment.status === "Pending" &&
      payment.mode === "Online" &&
      !canApplyPayment(payment)
    );
  });
  test("Offline payment is recorded as Paid", () => {
    const payment = recordOfflinePayment({
      payment: {
        id: "offline-paid-test",
        studentId: "student-1",
        amount: 1500,
        method: "Cash",
        mode: "Manual",
        createdAt: "2026-10-12T10:00:00.000Z",
      },
      recordedBy: "staff-1",
      reference: "CASH-001",
    });
    return (
      payment.status === "Paid" &&
      payment.mode === "Manual" &&
      payment.providerReference === "CASH-001" &&
      canApplyPayment(payment)
    );
  });
  test("Offline payment rejects missing staff identity", () => {
    try {
      recordOfflinePayment({
        payment: {
          id: "offline-no-staff",
          studentId: "student-1",
          amount: 1000,
          method: "Cash",
          mode: "Manual",
        },
        recordedBy: "",
      });
      return false;
    } catch {
      return true;
    }
  });
  test("Online payment rejects an unverified transaction", () => {
    const pending = createPayment({
      id: "online-unverified-test",
      studentId: "student-1",
      amount: 2000,
      method: "Online",
      mode: "Online",
    });
    try {
      verifyOnlinePayment(pending, {
        paymentId: pending.id,
        providerReference: "provider-ref-1",
        verifiedAmount: 2000,
        verified: false,
      });
      return false;
    } catch {
      return true;
    }
  });
  test("Online verification rejects an amount mismatch", () => {
    const pending = createPayment({
      id: "online-amount-mismatch",
      studentId: "student-1",
      amount: 2000,
      method: "Online",
      mode: "Online",
    });
    try {
      verifyOnlinePayment(pending, {
        paymentId: pending.id,
        providerReference: "provider-ref-2",
        verifiedAmount: 1500,
        verified: true,
      });
      return false;
    } catch {
      return true;
    }
  });
  test("Client-supplied verification cannot make an online payment eligible", () => {
    const pending = createPayment({
      id: "online-verified-test",
      studentId: "student-1",
      amount: 2000,
      method: "Online",
      mode: "Online",
    });
    try {
      verifyOnlinePayment(pending, {
        paymentId: pending.id,
        providerReference: "provider-ref-3",
        verifiedAmount: 2000,
        verified: true,
        verifiedAt: "2026-10-12T10:30:00.000Z",
      });
      return false;
    } catch {
      const forgedPaidRecord = {
        ...pending,
        status: "Paid" as const,
        verifiedAt: "2026-10-12T10:30:00.000Z",
      };
      return pending.status === "Pending" && !canApplyPayment(forgedPaidRecord);
    }
  });
  test("Payment amount converts to paise", () => {
    const payment = createPayment({
      id: "payment-paise-test",
      studentId: "student-1",
      amount: 123.45,
      method: "Online",
      mode: "Online",
    });
    return getPaymentAmountPaise(payment) === 12345;
  });
  /* =======================================================
     RECEIPT ENGINE TESTS
  ======================================================= */
  test("Receipt is generated for a recorded offline payment", () => {
    const student: Student = {
      id: "receipt-student-1",
      name: "Test Student",
      course: "Test Course",
      totalFee: 5000,
      installments: [],
    };
    const payment = recordOfflinePayment({
      payment: {
        id: "receipt-payment-1",
        studentId: student.id,
        amount: 1000,
        method: "Cash",
        mode: "Manual",
        createdAt: "2026-10-12T10:00:00.000Z",
      },
      recordedBy: "staff-1",
    });
    const receipts: AdvancePayment[] = [
      {
        id: payment.id,
        studentId: student.id,
        studentName: student.name,
        course: student.course,
        amount: payment.amount,
        paymentDate: "2026-10-12",
        method: payment.method,
        createdAt: payment.createdAt,
        // The receipt engine models AdvancePayment rows as receipts.
        // Mark the fee receipt fully applied so it is not shown as
        // unallocated advance in this engine-level test.
        appliedAmount: payment.amount,
        appliedTo: [],
      },
    ];
    const receipt = createPaymentReceipt(
      payment,
      student,
      receipts,
      "2026-10-12",
    );
    return (
      receipt.paymentId === payment.id &&
      receipt.studentId === student.id &&
      receipt.paymentStatus === "Paid" &&
      receipt.amount === 1000 &&
      receipt.totalReceived === 1000 &&
      receipt.advanceAvailable === 0 &&
      receipt.receiptNumber === `BB-${payment.id}`
    );
  });
  test("Receipt generation rejects a pending online payment", () => {
    const student: Student = {
      id: "pending-receipt-student",
      name: "Pending Student",
      totalFee: 3000,
    };
    const pending = createPayment({
      id: "pending-receipt-payment",
      studentId: student.id,
      amount: 1000,
      method: "Online",
      mode: "Online",
    });
    try {
      createPaymentReceipt(
        pending,
        student,
        [],
        "2026-10-12",
      );
      return false;
    } catch {
      return true;
    }
  });
  test("Receipt generation rejects a different student", () => {
    const payment = recordOfflinePayment({
      payment: {
        id: "wrong-student-payment",
        studentId: "student-A",
        amount: 1000,
        method: "UPI",
        mode: "Manual",
      },
      recordedBy: "staff-1",
    });
    const wrongStudent: Student = {
      id: "student-B",
      name: "Different Student",
      totalFee: 1000,
    };
    try {
      createPaymentReceipt(
        payment,
        wrongStudent,
        [],
        "2026-10-12",
      );
      return false;
    } catch {
      return true;
    }
  });
  /* =======================================================
     PAYMENT SERVICE INTEGRATION TESTS
  ======================================================= */
  test("Payment service stores ordinary fee receipts separately from advances", () => {
    resetPaymentServiceTestStorage();
    const result = recordOfflinePaymentService({
      payment: {
        id: "service-fee-payment-1",
        studentId: "payment-service-student",
        amount: 1500,
        method: "UPI",
        createdAt: "2026-10-13T09:00:00.000Z",
      },
      recordedBy: "staff-test-1",
      reference: "UPI-TEST-1",
    });
    const feeReceipts = readFeeReceipts();
    const advanceReceipts = readAdvancePayments();
    const history = readPaymentHistory();
    return (
      result.payment.status === "Paid" &&
      result.receiptRecord.paymentRecordId === result.payment.id &&
      feeReceipts.length === 1 &&
      feeReceipts[0]?.id === result.payment.id &&
      feeReceipts[0]?.course === "Test Course" &&
      advanceReceipts.length === 0 &&
      history.length === 1 &&
      history[0]?.id === result.payment.id &&
      readPaymentRecords().length === 1 &&
      result.receipt.advanceAvailable === 0
    );
  });
  test("Ordinary fee payment does not change an existing advance balance", () => {
    resetPaymentServiceTestStorage();
    const existingAdvance: AdvancePayment = {
      id: "service-existing-advance-1",
      studentId: "payment-service-student",
      studentName: "Payment Service Student",
      course: "Test Course",
      amount: 2000,
      paymentDate: "2026-10-12",
      method: "Cash",
      createdAt: "2026-10-12T09:00:00.000Z",
      appliedAmount: 500,
      appliedTo: [],
    };
    mockStorage.setItem(
      BIZBOOK_STORAGE_KEYS.advancePayments,
      JSON.stringify([existingAdvance]),
    );
    const result = recordOfflinePaymentService({
      payment: {
        id: "service-fee-with-advance-1",
        studentId: "payment-service-student",
        amount: 1000,
        method: "Cash",
        createdAt: "2026-10-13T10:00:00.000Z",
      },
      recordedBy: "staff-test-1",
    });
    const advancesAfterPayment = readAdvancePayments();
    const existingAdvanceAfterPayment = advancesAfterPayment[0];
    return (
      advancesAfterPayment.length === 1 &&
      existingAdvanceAfterPayment?.id === existingAdvance.id &&
      existingAdvanceAfterPayment !== undefined &&
      getReceiptAvailableAdvance(existingAdvanceAfterPayment) === 1500 &&
      readFeeReceipts().length === 1 &&
      result.receipt.advanceAvailable === 1500
    );
  });
  test("Payment service rejects duplicate payments without duplicate receipts or history", () => {
    resetPaymentServiceTestStorage();
    const input = {
      payment: {
        id: "service-duplicate-payment-1",
        studentId: "payment-service-student",
        amount: 1200,
        method: "UPI" as const,
        createdAt: "2026-10-13T11:00:00.000Z",
      },
      recordedBy: "staff-test-1",
    };
    recordOfflinePaymentService(input);
    let rejected = false;
    try {
      recordOfflinePaymentService(input);
    } catch {
      rejected = true;
    }
    return (
      rejected &&
      readPaymentRecords().length === 1 &&
      readFeeReceipts().length === 1 &&
      readPaymentHistory().length === 1
    );
  });
  test("Browser payment service rejects client-supplied online verification", () => {
    resetPaymentServiceTestStorage();
    const pending = createOnlinePayment({
      payment: {
        id: "service-online-payment-1",
        studentId: "payment-service-student",
        amount: 2500,
        createdAt: "2026-10-13T12:00:00.000Z",
      },
    });
    if (
      pending.status !== "Pending" ||
      readFeeReceipts().length !== 0 ||
      readPaymentHistory().length !== 0
    ) {
      return false;
    }
    let rejected = false;
    try {
      verifyOnlinePaymentService({
        paymentId: pending.id,
        providerReference: "provider-test-1",
        verifiedAmount: 2500,
        verified: true,
        verifiedAt: "2026-10-13T12:01:00.000Z",
      });
    } catch {
      rejected = true;
    }
    return (
      rejected &&
      pending.status === "Pending" &&
      readFeeReceipts().length === 0 &&
      readPaymentHistory().length === 0 &&
      readPaymentRecords().length === 1 &&
      readAdvancePayments().length === 0
    );
  });

  test("Ordinary fee receipts appear in balances, reports, and invoices once", () => {
    const student: Student = {
      id: "fee-receipt-report-student",
      name: "Fee Receipt Student",
      totalFee: 5000,
      installments: [],
    };
    const receipt: FeeReceipt = {
      id: "fee-receipt-report-1",
      paymentRecordId: "fee-receipt-report-1",
      studentId: student.id,
      studentName: student.name,
      amount: 1200,
      paymentDate: "2026-10-13",
      method: "UPI",
      createdAt: "2026-10-13T09:00:00.000Z",
    };

    const balance = calculateStudentBalance(student, [receipt]);
    const report = createFinancialReport([student], [receipt], []);
    const invoice = createFeeInvoice(student, [receipt], {
      today: "2026-10-13",
    });

    return (
      balance.totalReceived === 1200 &&
      balance.advanceAvailable === 0 &&
      report.totalReceived === 1200 &&
      report.paymentCount === 1 &&
      report.totalAvailableAdvance === 0 &&
      invoice.totalReceived === 1200 &&
      invoice.advanceAvailable === 0
    );
  });

  test("Legacy advance and fee receipt aliases count as one receipt", () => {
    const advance: AdvancePayment = {
      id: "receipt-alias-1",
      studentId: "receipt-alias-student",
      studentName: "Receipt Alias Student",
      amount: 800,
      paymentDate: "2026-10-12",
      method: "Cash",
      createdAt: "2026-10-12T09:00:00.000Z",
      appliedAmount: 800,
      appliedTo: [],
    };
    const feeReceipt: FeeReceipt = {
      id: advance.id,
      paymentRecordId: advance.id,
      studentId: advance.studentId,
      studentName: advance.studentName,
      amount: advance.amount,
      paymentDate: advance.paymentDate,
      method: advance.method,
      createdAt: advance.createdAt,
    };
    const combined = normalizeStudentReceiptRecords([
      feeReceipt,
      advance,
    ]);
    const report = createFinancialReport(
      [{
        id: advance.studentId,
        name: advance.studentName,
        totalFee: 2000,
        installments: [],
      }],
      [feeReceipt, advance],
      [],
    );

    return (
      combined.length === 1 &&
      combined[0]?.id === advance.id &&
      report.totalReceived === 800 &&
      report.paymentCount === 1
    );
  });
  test("Payment service receipt lookup finds a fee receipt", () => {
    resetPaymentServiceTestStorage();
    const result = recordOfflinePaymentService({
      payment: {
        id: "service-receipt-lookup-1",
        studentId: "payment-service-student",
        amount: 900,
        method: "Card",
        createdAt: "2026-10-13T12:30:00.000Z",
      },
      recordedBy: "staff-test-1",
    });
    const receipt = getPaymentReceipt(result.payment.id);
    return (
      receipt.paymentId === result.payment.id &&
      receipt.studentId === "payment-service-student" &&
      receipt.paymentStatus === "Paid" &&
      receipt.amount === 900 &&
      receipt.advanceAvailable === 0
    );
  });
  /* =======================================================
     RETURN RESULTS
  ======================================================= */
  return results;
}
/* =========================================================
   TEST REPORT
========================================================= */
export function runAndPrintBizBookTests(): boolean {
  const results = runBizBookTestCases();
  console.log("\n========== BIZBOOK BRAIN TESTS ==========\n");
  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"}: ${result.name}`,
    );
    if (!result.passed && result.error) {
      console.error(`  Reason: ${result.error}`);
    }
  }
  const passed = results.filter(
    (result) => result.passed,
  ).length;
  const failed = results.length - passed;
  console.log("\n=========================================");
  console.log(`Total:  ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("=========================================\n");
  return failed === 0;
}
/* =========================================================
   DIRECT EXECUTION
========================================================= */
const isDirectExecution = process.argv[1]
  ?.replace(/\\/g, "/")
  .endsWith("/lib/bizbook-brain/test-cases.ts");
if (isDirectExecution) {
  const passed = runAndPrintBizBookTests();
  if (!passed) {
    process.exitCode = 1;
  }
}
