"use client";

import { useState } from "react";
import { AlertTriangle, Check, Download, FileSearch, ShieldCheck, Upload } from "lucide-react";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAuthorizedTestProjectConfigured } from "@/lib/supabase/workspace-scope";
import type { Json } from "@/lib/supabase/database.types";
import {
  previewLegacyStorage,
  readLegacyStorageExport,
  type LegacyPreview,
} from "@/lib/legacy-import/preview";
import {
  legacyStudentRecordFingerprintInput,
  legacyStudentSourceKey,
  previewLegacyStudentImports,
  type LegacyStudentImportPreview,
} from "@/lib/legacy-import/student-import";
import {
  legacyStaffRecordFingerprintInput,
  previewLegacyStaffImports,
  type LegacyStaffImportPreview,
} from "@/lib/legacy-import/staff-import";
import {
  LEGACY_EXPENSE_SOURCE_KEY,
  previewLegacyExpenseImports,
  type LegacyExpenseImportPreview,
} from "@/lib/legacy-import/expense-import";
import {
  previewLegacyBusinessProfile,
  type LegacyBusinessProfilePreview,
} from "@/lib/legacy-import/business-profile-import";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatPaise(paise: number): string {
  const rupees = BigInt(Math.trunc(paise / 100));
  const fraction = String(paise % 100).padStart(2, "0");
  return money.format(rupees) + "." + fraction;
}

function formatBytes(value: number): string {
  if (value < 1024) return String(value) + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  return (value / (1024 * 1024)).toFixed(2) + " MB";
}

export default function LegacyImportPreview() {
  const { institutes, selection, loading: workspaceLoading } = useWorkspaceScope();
  const [preview, setPreview] = useState<LegacyPreview | null>(null);
  const [previewInstituteId, setPreviewInstituteId] = useState<string | null>(null);
  const [studentImportPreview, setStudentImportPreview] = useState<LegacyStudentImportPreview | null>(null);
  const [studentImportInstituteId, setStudentImportInstituteId] = useState<string | null>(null);
  const [staffImportPreview, setStaffImportPreview] = useState<LegacyStaffImportPreview | null>(null);
  const [staffImportInstituteId, setStaffImportInstituteId] = useState<string | null>(null);
  const [expenseImportPreview, setExpenseImportPreview] = useState<LegacyExpenseImportPreview | null>(null);
  const [expenseImportInstituteId, setExpenseImportInstituteId] = useState<string | null>(null);
  const [businessProfilePreview, setBusinessProfilePreview] = useState<LegacyBusinessProfilePreview | null>(null);
  const [businessProfileInstituteId, setBusinessProfileInstituteId] = useState<string | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const [confirmUnpaidImport, setConfirmUnpaidImport] = useState(false);
  const [confirmProfileOnlyImport, setConfirmProfileOnlyImport] = useState(false);
  const [confirmHistoricalExpenses, setConfirmHistoricalExpenses] = useState(false);
  const [importReport, setImportReport] = useState<{
    imported: number;
    alreadyImported: number;
    failed: number;
    schedulePaise: number;
    rows: Array<{ name: string; status: string; message: string }>;
  } | null>(null);
  const [staffImportReport, setStaffImportReport] = useState<{
    imported: number;
    alreadyImported: number;
    failed: number;
    rows: Array<{ name: string; status: string; message: string }>;
  } | null>(null);
  const [expenseImportReport, setExpenseImportReport] = useState<{
    imported: number;
    alreadyImported: number;
    failed: number;
    amountPaise: number;
    rows: Array<{ name: string; status: string; message: string }>;
  } | null>(null);
  const [businessProfileImportReport, setBusinessProfileImportReport] = useState<{
    imported: boolean;
    alreadyImported: boolean;
    filledFields: string[];
    skippedFields: string[];
  } | null>(null);
  const [confirmBusinessProfileImport, setConfirmBusinessProfileImport] = useState(false);
  const [busy, setBusy] = useState<"scan" | "export" | "import" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const institute = institutes.find((item) => item.id === selection?.instituteId);
  const canReview = !!institute
    && (institute.role === "owner" || institute.role === "administrator")
    && institute.accessScope === "institute";
  const activePreview = !workspaceLoading && canReview && previewInstituteId === institute?.id
    ? preview
    : null;
  const activeStudentPreview = !workspaceLoading && canReview && studentImportInstituteId === institute?.id
    ? studentImportPreview
    : null;
  const activeStaffPreview = !workspaceLoading && canReview && staffImportInstituteId === institute?.id
    ? staffImportPreview
    : null;
  const activeExpensePreview = !workspaceLoading && canReview && expenseImportInstituteId === institute?.id
    ? expenseImportPreview
    : null;
  const activeBusinessProfilePreview = !workspaceLoading && canReview && businessProfileInstituteId === institute?.id
    ? businessProfilePreview
    : null;
  const eligibleStudents = activeStudentPreview?.candidates.filter((candidate) => candidate.eligible) ?? [];
  const eligibleStaff = activeStaffPreview?.candidates.filter((candidate) => candidate.eligible) ?? [];
  const eligibleExpenses = activeExpensePreview?.candidates.filter((candidate) => candidate.eligible) ?? [];

  async function scan() {
    const scanInstituteId = institute?.id;
    setBusy("scan");
    setError("");
    setNotice("");
    setPreview(null);
    setPreviewInstituteId(null);
    setStudentImportPreview(null);
    setStudentImportInstituteId(null);
    setStaffImportPreview(null);
    setStaffImportInstituteId(null);
    setExpenseImportPreview(null);
    setExpenseImportInstituteId(null);
    setBusinessProfilePreview(null);
    setBusinessProfileInstituteId(null);
    setSelectedStudentIds([]);
    setSelectedStaffIds([]);
    setSelectedExpenseIds([]);
    setConfirmUnpaidImport(false);
    setConfirmProfileOnlyImport(false);
    setConfirmHistoricalExpenses(false);
    setConfirmBusinessProfileImport(false);
    setImportReport(null);
    setStaffImportReport(null);
    setExpenseImportReport(null);
    setBusinessProfileImportReport(null);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    try {
      setPreview(previewLegacyStorage(window.localStorage));
      setStudentImportPreview(previewLegacyStudentImports(window.localStorage));
      setStaffImportPreview(previewLegacyStaffImports(window.localStorage));
      setExpenseImportPreview(previewLegacyExpenseImports(window.localStorage));
      setBusinessProfilePreview(previewLegacyBusinessProfile(window.localStorage));
      setPreviewInstituteId(scanInstituteId ?? null);
      setStudentImportInstituteId(scanInstituteId ?? null);
      setStaffImportInstituteId(scanInstituteId ?? null);
      setExpenseImportInstituteId(scanInstituteId ?? null);
      setBusinessProfileInstituteId(scanInstituteId ?? null);
    } catch {
      setPreview(null);
      setPreviewInstituteId(null);
      setError("Browser storage could not be inspected. No data was changed.");
    } finally {
      setBusy(null);
    }
  }

  async function importSelectedStudents() {
    if (!institute || !activeStudentPreview || !canReview) return;
    if (!isAuthorizedTestProjectConfigured()) {
      setError("Legacy import is enabled only for the authorized test project in this build.");
      return;
    }
    if (!confirmUnpaidImport) {
      setError("Confirm that the selected students have no legacy payment history before importing.");
      return;
    }
    const candidates = activeStudentPreview.candidates.filter(
      (candidate) => candidate.eligible && selectedStudentIds.includes(candidate.sourceRecordId),
    ).slice(0, 100);
    if (!candidates.length) {
      setError("Select at least one eligible student to import.");
      return;
    }

    setBusy("import");
    setError("");
    setNotice("");
    setImportReport(null);
    let imported = 0;
    let alreadyImported = 0;
    let failed = 0;
    let schedulePaise = 0;
    const failedSourceIds: string[] = [];
    const rows: Array<{ name: string; status: string; message: string }> = [];
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      setBusy(null);
      setError("The database client is unavailable. Browser records were not changed; retry after workspace setup.");
      return;
    }
    const branchId: string | null = null;

    for (const candidate of candidates) {
      try {
        const targetStudentId = crypto.randomUUID();
        const fingerprintBytes = new TextEncoder().encode(legacyStudentRecordFingerprintInput(candidate));
        const fingerprintDigest = await crypto.subtle.digest("SHA-256", fingerprintBytes);
        const fingerprint = Array.from(new Uint8Array(fingerprintDigest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const installments = candidate.installments.map((installment, index) => ({
          ...(installment as Record<string, Json>),
          id: `${targetStudentId}:fee:${index + 1}`,
        }));
        const { data, error: importError } = await supabase.rpc("import_legacy_student_record", {
          p_institute_id: institute.id,
          p_branch_id: branchId,
          p_source_key: legacyStudentSourceKey(),
          p_source_record_id: candidate.sourceRecordId,
          p_source_fingerprint: fingerprint,
          p_student_id: targetStudentId,
          p_student: candidate.student as Json,
          p_installments: installments,
          p_confirm_unpaid_schedule: true,
        });
        if (importError || !data?.[0]?.imported_student_id) {
          failed += 1;
          failedSourceIds.push(candidate.sourceRecordId);
          const message = importError?.code === "23505"
            ? "This source ID was already imported with different data or conflicts with an existing mapping. Review it before retrying."
            : importError?.code === "42501"
              ? "The database denied this institute or branch import. Refresh access and retry."
              : "The database did not confirm this import. Retry the same source row; its idempotency mapping prevents duplicates.";
          rows.push({ name: candidate.name, status: "Needs review", message });
          continue;
        }
        schedulePaise += candidate.scheduleTotalPaise;
        if (data[0].was_already_imported) {
          alreadyImported += 1;
          rows.push({ name: candidate.name, status: "Already imported", message: "The original target record was returned; no duplicate was created." });
        } else {
          imported += 1;
          rows.push({ name: candidate.name, status: "Imported", message: "Student and unpaid fee schedule were saved atomically." });
        }
      } catch {
        failed += 1;
        failedSourceIds.push(candidate.sourceRecordId);
        rows.push({ name: candidate.name, status: "Needs review", message: "The import could not be confirmed. Keep the original browser data and retry this source row." });
      }
    }
    setImportReport({ imported, alreadyImported, failed, schedulePaise, rows });
    const processedIds = new Set(candidates.map((candidate) => candidate.sourceRecordId));
    setSelectedStudentIds((current) => [
      ...current.filter((id) => !processedIds.has(id)),
      ...failedSourceIds,
    ]);
    setConfirmUnpaidImport(false);
    if (imported + alreadyImported > 0) {
      setNotice("The database confirmed the selected student imports. Legacy browser keys were left unchanged.");
    } else {
      setError("No student import was confirmed. Keep the original browser data and review the row errors below.");
    }
    setBusy(null);
  }

  async function importSelectedStaff() {
    if (!institute || !activeStaffPreview || !canReview) return;
    if (!isAuthorizedTestProjectConfigured()) {
      setError("Legacy import is enabled only for the authorized test project in this build.");
      return;
    }
    if (!confirmProfileOnlyImport) {
      setError("Confirm that attendance and salary history will not be imported by this operation.");
      return;
    }
    const candidates = activeStaffPreview.candidates.filter(
      (candidate) => candidate.eligible && selectedStaffIds.includes(candidate.sourceRecordId),
    ).slice(0, 100);
    if (!candidates.length) {
      setError("Select at least one eligible staff profile to import.");
      return;
    }

    setBusy("import");
    setError("");
    setNotice("");
    setStaffImportReport(null);
    let imported = 0;
    let alreadyImported = 0;
    let failed = 0;
    const failedSourceIds: string[] = [];
    const rows: Array<{ name: string; status: string; message: string }> = [];
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      setBusy(null);
      setError("The database client is unavailable. Browser records were not changed; retry after workspace setup.");
      return;
    }

    for (const candidate of candidates) {
      try {
        const fingerprintBytes = new TextEncoder().encode(legacyStaffRecordFingerprintInput(candidate));
        const fingerprintDigest = await crypto.subtle.digest("SHA-256", fingerprintBytes);
        const fingerprint = Array.from(new Uint8Array(fingerprintDigest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const { data, error: importError } = await supabase.rpc("import_legacy_staff_record", {
          p_institute_id: institute.id,
          p_branch_id: null,
          p_source_key: "bizbook-students-staff-v1",
          p_source_record_id: candidate.sourceRecordId,
          p_source_fingerprint: fingerprint,
          p_staff_id: crypto.randomUUID(),
          p_name: candidate.name,
          p_gender: candidate.gender,
          p_mobile: candidate.mobile,
          p_whatsapp: candidate.whatsapp,
          p_designation: candidate.designation,
          p_joining_date: candidate.joiningDate,
          p_monthly_salary: candidate.monthlySalaryPaise / 100,
          p_payment_day: candidate.paymentDay,
          p_per_day_leave_cut: candidate.perDayLeaveCutPaise / 100,
          p_manual_payable_amount: candidate.manualPayablePaise === null ? null : candidate.manualPayablePaise / 100,
          p_salary_calculation_mode: candidate.salaryCalculationMode,
          p_attendance_enabled: candidate.attendanceEnabled,
          p_confirm_profile_only: true,
        });
        if (importError || !data?.[0]?.imported_staff_id) {
          failed += 1;
          failedSourceIds.push(candidate.sourceRecordId);
          const message = importError?.code === "23505"
            ? "This source ID was already imported with different data or conflicts with an existing mapping. Review it before retrying."
            : importError?.code === "42501"
              ? "The database denied this institute or branch import. Refresh access and retry."
              : "The database did not confirm this import. Keep the browser source and retry the same row.";
          rows.push({ name: candidate.name, status: "Needs review", message });
          continue;
        }
        if (data[0].was_already_imported) {
          alreadyImported += 1;
          rows.push({ name: candidate.name, status: "Already imported", message: "The original target record was returned; no duplicate was created." });
        } else {
          imported += 1;
          rows.push({ name: candidate.name, status: "Imported", message: "Staff profile and current compensation settings were saved atomically. No history rows were imported." });
        }
      } catch {
        failed += 1;
        failedSourceIds.push(candidate.sourceRecordId);
        rows.push({ name: candidate.name, status: "Needs review", message: "The import could not be confirmed. Keep the original browser data and retry this source row." });
      }
    }
    setStaffImportReport({ imported, alreadyImported, failed, rows });
    const processedIds = new Set(candidates.map((candidate) => candidate.sourceRecordId));
    setSelectedStaffIds((current) => [
      ...current.filter((id) => !processedIds.has(id)),
      ...failedSourceIds,
    ]);
    setConfirmProfileOnlyImport(false);
    if (imported + alreadyImported > 0) {
      setNotice("The database confirmed the selected staff imports. Attendance, payroll history, and browser keys were left unchanged.");
    } else {
      setError("No staff import was confirmed. Keep the original browser data and review the row errors below.");
    }
    setBusy(null);
  }

  async function importSelectedExpenses() {
    if (!institute || !activeExpensePreview || !canReview) return;
    if (!isAuthorizedTestProjectConfigured()) {
      setError("Legacy import is enabled only for the authorized test project in this build.");
      return;
    }
    if (!confirmHistoricalExpenses) {
      setError("Confirm that these are real historical business costs and were not already recorded in the shared ledger.");
      return;
    }
    const candidates = activeExpensePreview.candidates.filter(
      (candidate) => candidate.eligible && selectedExpenseIds.includes(candidate.sourceRecordId),
    ).slice(0, 100);
    if (!candidates.length) {
      setError("Select at least one eligible expense to import.");
      return;
    }

    setBusy("import");
    setError("");
    setNotice("");
    setExpenseImportReport(null);
    let imported = 0;
    let alreadyImported = 0;
    let failed = 0;
    let amountPaise = 0;
    const failedSourceIds: string[] = [];
    const rows: Array<{ name: string; status: string; message: string }> = [];
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      setBusy(null);
      setError("The database client is unavailable. Browser records were not changed; retry after workspace setup.");
      return;
    }

    for (const candidate of candidates) {
      try {
        if (!candidate.method) throw new Error("Missing validated expense method.");
        const { data, error: importError } = await supabase.rpc("import_legacy_expense_record_verified", {
          p_institute_id: institute.id,
          p_branch_id: null,
          p_source_key: LEGACY_EXPENSE_SOURCE_KEY,
          p_source_record_id: candidate.sourceRecordId,
          p_title: candidate.title,
          p_category: candidate.category,
          p_amount: candidate.amountPaise / 100,
          p_expense_date: candidate.expenseDate,
          p_method: candidate.method,
          p_notes: candidate.notes,
          p_confirm_historical_expense: true,
        });
        if (importError || !data?.[0]?.imported_expense_id) {
          failed += 1;
          failedSourceIds.push(candidate.sourceRecordId);
          const message = importError?.code === "23505"
            ? "This source ID was imported with changed data or conflicts with an existing expense. Review it before retrying."
            : importError?.code === "42501"
              ? "The database denied this institute or branch import. Refresh access and retry."
              : "The database did not confirm this import. Keep the original browser data and retry the same row.";
          rows.push({ name: candidate.title, status: "Needs review", message });
          continue;
        }
        amountPaise += candidate.amountPaise;
        if (data[0].was_already_imported) {
          alreadyImported += 1;
          rows.push({ name: candidate.title, status: "Already imported", message: "The original shared expense was returned; no duplicate was created." });
        } else {
          imported += 1;
          rows.push({ name: candidate.title, status: "Imported", message: "The expense and its source mapping were saved atomically and audited." });
        }
      } catch {
        failed += 1;
        failedSourceIds.push(candidate.sourceRecordId);
        rows.push({ name: candidate.title, status: "Needs review", message: "The import could not be confirmed. Keep the original browser data and retry this source row." });
      }
    }
    setExpenseImportReport({ imported, alreadyImported, failed, amountPaise, rows });
    const processedIds = new Set(candidates.map((candidate) => candidate.sourceRecordId));
    setSelectedExpenseIds((current) => [
      ...current.filter((id) => !processedIds.has(id)),
      ...failedSourceIds,
    ]);
    setConfirmHistoricalExpenses(false);
    if (imported + alreadyImported > 0) {
      setNotice("The database confirmed the selected expense imports. Original browser keys were left unchanged.");
    } else {
      setError("No expense import was confirmed. Keep the original browser data and review the row errors below.");
    }
    setBusy(null);
  }

  async function importBusinessProfile() {
    if (!institute || !activeBusinessProfilePreview?.eligible || !canReview) return;
    if (!isAuthorizedTestProjectConfigured()) {
      setError("Legacy import is enabled only for the authorized test project in this build.");
      return;
    }
    if (!confirmBusinessProfileImport) {
      setError("Confirm that this profile belongs to the selected institute and that existing fields must not be overwritten.");
      return;
    }

    setBusy("import");
    setError("");
    setNotice("");
    setBusinessProfileImportReport(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: importError } = await supabase.rpc("import_legacy_business_profile", {
        p_institute_id: institute.id,
        p_profile: activeBusinessProfilePreview.profile as Json,
        p_confirm_no_overwrite: true,
      });
      if (importError || !data?.[0]) {
        setError(importError?.code === "23505"
          ? "This profile changed after a previous import. Review it for manual reconciliation; nothing was overwritten."
          : importError?.code === "42501"
            ? "The database denied this institute profile import. Refresh access and retry."
            : "The database did not confirm this profile import. The browser source remains unchanged.");
        return;
      }
      const result = data[0];
      setBusinessProfileImportReport({
        imported: !result.was_already_imported,
        alreadyImported: result.was_already_imported,
        filledFields: result.filled_fields ?? [],
        skippedFields: result.skipped_fields ?? [],
      });
      setNotice(result.was_already_imported
        ? "The database confirmed this exact profile import was already processed. No fields were changed."
        : "The database confirmed the profile import. Only previously blank institute fields were filled; existing values and browser data were preserved.");
      setConfirmBusinessProfileImport(false);
    } catch {
      setError("The profile import could not be confirmed. Keep the browser backup and retry the same reviewed values.");
    } finally {
      setBusy(null);
    }
  }

  function downloadBackup() {
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const snapshot = readLegacyStorageExport(window.localStorage);
      const contents = {
        format: "bizbook-legacy-browser-export-v1",
        exportedAt: new Date().toISOString(),
        scopeNote: "All recognized legacy keys from this browser are included. No institute or branch mapping is verified.",
        warning: "Contains private institute, student, staff, and financial data. Store it securely.",
        sources: snapshot,
      };
      const blob = new Blob([JSON.stringify(contents, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "bizbook-legacy-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("A local backup was downloaded. Browser records were not changed or uploaded.");
    } catch {
      setError("The browser backup could not be created. Original browser records were not changed.");
    } finally {
      setBusy(null);
    }
  }

  const previewSummary = activePreview
    ? String(activePreview.presentSourceCount) + " storage keys | "
      + String(activePreview.totalRecords) + " entries | " + formatBytes(activePreview.totalBytes)
    : "";

  return (
    <main className="p-4 pt-20 sm:p-6 sm:pt-20">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <p className="text-sm font-semibold text-violet-700">Account settings</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Legacy data review</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Preview records still stored in this browser. Scanning stays local. Only selected, normalized,
            eligible unpaid student schedules, staff profiles/current compensation settings, reviewed expenses, or blank-only institute profile fields are sent to the authorized test database after your confirmation.
          </p>
        </header>

        {workspaceLoading && <p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Checking workspace access...</p>}
        {!workspaceLoading && (!institute || !canReview) && (
          <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Select an institute where you have an active institute-wide owner or administrator role to review legacy data.
          </p>
        )}
        {institute && canReview && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">Review access</h2>
                <p className="mt-1 text-sm text-slate-600">{institute.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  This institute authorizes the review only. The browser data has no verified mapping to it.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void scan()} disabled={busy !== null} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  <FileSearch size={16} />{busy === "scan" ? "Scanning..." : "Preview browser data"}
                </button>
                <button type="button" onClick={downloadBackup} disabled={busy !== null} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
                  <Download size={16} />{busy === "export" ? "Preparing..." : "Download original backup"}
                </button>
              </div>
            </div>
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              The backup contains private student, staff, profile, and financial data. Keep it in secure storage.
              Downloading does not delete or modify browser records.
            </p>
          </section>
        )}

        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}

        {activePreview && (
          <>
            <section aria-label="Preview totals" className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">Found</p><p className="mt-1 text-xl font-bold text-slate-950">{previewSummary}</p></div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-semibold uppercase text-amber-800">Needs reconciliation</p><p className="mt-1 text-xl font-bold text-amber-950">{activePreview.totalMalformedRecords + activePreview.totalInvalidAmounts + activePreview.totalInvalidDates + activePreview.totalRepeatedIdOccurrences}</p><p className="text-xs text-amber-900">Malformed, invalid amount/date, or repeated-ID observations</p></div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-xs font-semibold uppercase text-rose-800">Unverified claims</p><p className="mt-1 text-xl font-bold text-rose-950">{activePreview.totalUnverifiedOnlinePaidClaims + activePreview.totalCompletedRefundClaims}</p><p className="text-xs text-rose-900">Online-paid and completed-refund status claims are not proof</p></div>
            </section>
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-4"><h2 className="font-semibold text-slate-950">Per-key preview</h2><p className="mt-1 text-xs text-slate-500">Only counts and totals are shown. Record values, names, contacts, and source IDs are not displayed.</p></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Browser key</th><th className="p-3">Entries</th><th className="p-3">Observed amount</th><th className="p-3">Repeated IDs</th><th className="p-3">Date range</th><th className="p-3">Scan result</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {activePreview.sources.map((source) => <tr key={source.key}>
                      <td className="p-3"><span className="font-medium text-slate-900">{source.label}</span><span className="mt-0.5 block font-mono text-[11px] text-slate-500">{source.key}</span></td>
                      <td className="p-3 tabular-nums">{source.present ? source.records : "-"}</td>
                      <td className="p-3 tabular-nums">{source.observedAmountPaise ? formatPaise(source.observedAmountPaise) : "-"}{source.invalidAmounts > 0 && <span className="mt-0.5 block text-xs text-rose-700">{source.invalidAmounts} invalid amount(s)</span>}</td>
                      <td className="p-3 tabular-nums">{source.repeatedIdOccurrences || "-"}</td>
                      <td className="p-3 tabular-nums">{source.firstDate ? source.firstDate + " to " + source.lastDate : "-"}</td>
                      <td className="p-3">{source.issue ? <span className="text-xs text-amber-800">{source.issue}</span> : source.present ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><ShieldCheck size={14} />Scanned locally{source.invalidDates > 0 ? <span className="ml-1 text-rose-700">| {source.invalidDates} invalid date(s)</span> : null}</span> : <span className="text-xs text-slate-400">Not found</span>}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
              <h2 className="font-semibold text-amber-950">Financial legacy records still need reconciliation</h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                This import only covers reviewed new student profiles with unpaid fee schedules and staff profiles
                with current compensation settings when no attendance/payroll history is linked. Attendance,
                Attendance, payments, advances, payroll transactions, refunds, and logos are not imported here. Expenses and institute profile fields have separate, explicitly reviewed workflows below.
                A browser payment status cannot prove a receipt or refund. All original browser keys remain unchanged.
              </p>
            </section>
            {activeBusinessProfilePreview && (
              <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                <div>
                  <h2 className="font-semibold text-slate-950">Review legacy institute profile</h2>
                  <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
                    Only recognized text fields are shown. The database fills blank profile fields, skips every field that already has a value, and records field names plus a server-generated fingerprint. Logo files are not imported here.
                  </p>
                </div>
                {activeBusinessProfilePreview.reason && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{activeBusinessProfilePreview.reason}</p>}
                {activeBusinessProfilePreview.eligible && (
                  <>
                    <dl className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(activeBusinessProfilePreview.profile).map(([field, value]) => (
                        <div key={field} className="rounded-lg border border-slate-200 p-3">
                          <dt className="text-xs font-semibold uppercase text-slate-500">{field}</dt>
                          <dd className="mt-1 break-words text-sm text-slate-900">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
                      <input type="checkbox" checked={confirmBusinessProfileImport} onChange={(event) => setConfirmBusinessProfileImport(event.target.checked)} disabled={busy !== null} className="mt-1" />
                      <span>I verified that this browser profile belongs to {institute?.name}. Import only into blank fields, keep existing database values, and preserve the original browser data.</span>
                    </label>
                    <button type="button" onClick={() => void importBusinessProfile()} disabled={busy !== null || !confirmBusinessProfileImport || !isAuthorizedTestProjectConfigured()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                      <Upload size={16} />{busy === "import" ? "Importing profile..." : "Import into blank profile fields"}
                    </button>
                    {!isAuthorizedTestProjectConfigured() && <p className="text-xs text-amber-900">Import is disabled unless this build points to the authorized test project.</p>}
                  </>
                )}
                {businessProfileImportReport && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-live="polite">
                    <h3 className="font-semibold text-slate-950">Profile import result</h3>
                    <p className="mt-1 text-sm text-slate-700">{businessProfileImportReport.alreadyImported ? "Already imported; no database changes were made." : businessProfileImportReport.imported ? "Import recorded." : "No changes were made."}</p>
                    {businessProfileImportReport.filledFields.length > 0 && <p className="mt-2 text-sm text-slate-700">Filled: {businessProfileImportReport.filledFields.join(", ")}</p>}
                    {businessProfileImportReport.skippedFields.length > 0 && <p className="mt-1 text-sm text-slate-700">Skipped because the database already had values: {businessProfileImportReport.skippedFields.join(", ")}</p>}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {activeStudentPreview && (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-950">Import eligible student profiles</h2>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
                This sends only the fields shown below, plus an unpaid schedule, to the selected institute. The database
                creates each student and schedule atomically, checks institute/branch authorization, stores an idempotency
                fingerprint without the raw browser record, and audits the import. Records linked to any payment/refund
                history or carrying paid-balance claims are excluded.
              </p>
            </div>

            {activeStudentPreview.issue && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{activeStudentPreview.issue}</p>}
            {!activeStudentPreview.issue && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">{eligibleStudents.length} eligible</span>
                  <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800">{activeStudentPreview.candidates.length - eligibleStudents.length} held for review</span>
                  {activeStudentPreview.candidates.length > 100 && <span className="text-slate-600">Imports run in batches of up to 100 records.</span>}
                </div>

                <p className="text-xs text-slate-500">Imported records are assigned to this institute workspace.</p>

                {activeStudentPreview.candidates.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[1040px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="w-12 p-3">Import</th><th className="p-3">Student</th><th className="p-3">Parent/guardian contact</th><th className="p-3">Course</th><th className="p-3">Fee schedule</th><th className="p-3">Review</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeStudentPreview.candidates.map((candidate) => (
                          <tr key={candidate.sourceRecordId} className={candidate.eligible ? "" : "bg-amber-50/50"}>
                            <td className="p-3">
                              <input
                                aria-label={`Select ${candidate.name} for import`}
                                type="checkbox"
                                checked={candidate.eligible && selectedStudentIds.includes(candidate.sourceRecordId)}
                                disabled={!candidate.eligible || busy !== null}
                                onChange={(event) => setSelectedStudentIds((current) => event.target.checked
                                  ? [...current, candidate.sourceRecordId]
                                  : current.filter((id) => id !== candidate.sourceRecordId))}
                              />
                            </td>
                            <td className="p-3"><span className="font-medium text-slate-950">{candidate.name}</span><span className="mt-0.5 block font-mono text-[11px] text-slate-500">Source ID: {candidate.sourceRecordId}</span></td>
                            <td className="p-3 text-xs text-slate-700"><span className="block">{candidate.parentName || "No parent name"}</span><span className="mt-0.5 block">{candidate.parentEmail || "No email"} · {candidate.parentMobile || "No mobile"}</span><span className="mt-0.5 block">WhatsApp: {candidate.whatsapp || "Not provided"}</span></td>
                            <td className="p-3">{candidate.course || "—"}</td>
                            <td className="p-3 tabular-nums">{candidate.eligible ? formatPaise(candidate.totalFeePaise) : "—"}<span className="mt-0.5 block text-xs text-slate-500">{candidate.eligible ? `${candidate.installments.length} scheduled installment(s); unpaid` : "Not eligible"}</span></td>
                            <td className="p-3">{candidate.eligible
                              ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check size={14} />Ready for owner review</span>
                              : <span className="text-xs leading-5 text-amber-900">{candidate.reason}</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No student records were found in the legacy key.</p>
                )}

                {eligibleStudents.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSelectedStudentIds(eligibleStudents.slice(0, 100).map((candidate) => candidate.sourceRecordId))} disabled={busy !== null} className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Select first 100 eligible</button>
                      <button type="button" onClick={() => setSelectedStudentIds([])} disabled={busy !== null} className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear selection</button>
                    </div>
                    <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
                      <input type="checkbox" checked={confirmUnpaidImport} onChange={(event) => setConfirmUnpaidImport(event.target.checked)} disabled={busy !== null} className="mt-1" />
                      <span>I reviewed the selected rows and confirm they are new student records with no actual or claimed payment, advance, refund, or receipt history. The imported installment balances will begin unpaid.</span>
                    </label>
                    <button type="button" onClick={() => void importSelectedStudents()} disabled={busy !== null || selectedStudentIds.length === 0 || !confirmUnpaidImport || !isAuthorizedTestProjectConfigured()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                      <Upload size={16} />{busy === "import" ? "Importing selected records..." : `Import ${Math.min(selectedStudentIds.length, 100)} selected student(s)`}
                    </button>
                    {!isAuthorizedTestProjectConfigured() && <p className="text-xs text-amber-900">Import is disabled unless this build points to the authorized test project.</p>}
                  </>
                )}
              </>
            )}

            {importReport && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-live="polite">
                <h3 className="font-semibold text-slate-950">Import result</h3>
                <p className="text-sm text-slate-700">{importReport.imported} imported · {importReport.alreadyImported} already imported · {importReport.failed} need review. Fee schedule represented by confirmed imports: {formatPaise(importReport.schedulePaise)}. This is scheduled tuition, not money received.</p>
                <ul className="space-y-2 text-sm">
                  {importReport.rows.map((row, index) => <li key={`${row.name}-${index}`} className="rounded-lg bg-white p-3"><span className="font-semibold text-slate-900">{row.name}: {row.status}.</span> <span className="text-slate-600">{row.message}</span></li>)}
                </ul>
              </div>
            )}
          </section>
        )}

        {activeStaffPreview && (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-950">Review legacy staff profiles</h2>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
                This optional import saves a staff directory profile and its current compensation settings only.
                Attendance rows and salary payments are never imported here. The database records an idempotency
                fingerprint and audit event, without storing the original browser payload.
              </p>
            </div>
            {activeStaffPreview.issue && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{activeStaffPreview.issue}</p>}
            {!activeStaffPreview.issue && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">{eligibleStaff.length} eligible</span>
                  <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800">{activeStaffPreview.candidates.length - eligibleStaff.length} held for review</span>
                  {activeStaffPreview.candidates.length > 100 && <span className="text-slate-600">Imports run in batches of up to 100 records.</span>}
                </div>
                <p className="text-xs text-slate-500">Imported profiles are assigned to this institute workspace.</p>
                {activeStaffPreview.candidates.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[1120px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="w-12 p-3">Import</th><th className="p-3">Staff member</th><th className="p-3">Contact</th><th className="p-3">Role / gender</th><th className="p-3">Salary configuration</th><th className="p-3">Review</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeStaffPreview.candidates.map((candidate) => (
                          <tr key={candidate.sourceRecordId} className={candidate.eligible ? "" : "bg-amber-50/50"}>
                            <td className="p-3"><input aria-label={`Select ${candidate.name} for staff import`} type="checkbox" checked={candidate.eligible && selectedStaffIds.includes(candidate.sourceRecordId)} disabled={!candidate.eligible || busy !== null} onChange={(event) => setSelectedStaffIds((current) => event.target.checked ? [...current, candidate.sourceRecordId] : current.filter((id) => id !== candidate.sourceRecordId))} /></td>
                            <td className="p-3"><span className="font-medium text-slate-950">{candidate.name}</span><span className="mt-0.5 block font-mono text-[11px] text-slate-500">Source ID: {candidate.sourceRecordId}</span><span className="mt-0.5 block text-xs text-slate-500">{candidate.joiningDate ? `Joined ${candidate.joiningDate}` : "No joining date"}</span></td>
                            <td className="p-3 text-xs text-slate-700">{candidate.mobile || candidate.whatsapp || "No contact"}<span className="mt-0.5 block">{candidate.mobile && candidate.whatsapp && candidate.mobile !== candidate.whatsapp ? `WhatsApp ${candidate.whatsapp}` : ""}</span></td>
                            <td className="p-3">{candidate.designation || "—"}<span className="mt-0.5 block text-xs text-slate-500">{candidate.gender || "Gender not set"}</span></td>
                            <td className="p-3 tabular-nums"><span className="block">{candidate.eligible ? formatPaise(candidate.monthlySalaryPaise) : "—"} / month</span><span className="mt-0.5 block text-xs text-slate-600">{candidate.salaryCalculationMode === "Fixed" ? "Fixed" : "Attendance-based"} · pay day {candidate.paymentDay ?? "not set"}</span><span className="mt-0.5 block text-xs text-slate-600">Leave deduction/day: {candidate.eligible ? formatPaise(candidate.perDayLeaveCutPaise) : "—"}</span><span className="mt-0.5 block text-xs text-slate-600">Manual payable: {candidate.manualPayablePaise === null ? "not set" : candidate.eligible ? formatPaise(candidate.manualPayablePaise) : "—"}</span></td>
                            <td className="p-3">{candidate.eligible ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check size={14} />Ready for owner review</span> : <span className="text-xs leading-5 text-amber-900">{candidate.reason}</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No staff profiles were found in the legacy directory.</p>}
                {eligibleStaff.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSelectedStaffIds(eligibleStaff.slice(0, 100).map((candidate) => candidate.sourceRecordId))} disabled={busy !== null} className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Select first 100 eligible</button>
                      <button type="button" onClick={() => setSelectedStaffIds([])} disabled={busy !== null} className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear selection</button>
                    </div>
                    <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
                      <input type="checkbox" checked={confirmProfileOnlyImport} onChange={(event) => setConfirmProfileOnlyImport(event.target.checked)} disabled={busy !== null} className="mt-1" />
                      <span>I reviewed these profiles and authorize importing current directory and compensation settings only. No attendance records, salary payments, leave balances, or browser records will be changed.</span>
                    </label>
                    <button type="button" onClick={() => void importSelectedStaff()} disabled={busy !== null || selectedStaffIds.length === 0 || !confirmProfileOnlyImport || !isAuthorizedTestProjectConfigured()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                      <Upload size={16} />{busy === "import" ? "Importing selected records..." : `Import ${Math.min(selectedStaffIds.length, 100)} selected staff profile(s)`}
                    </button>
                    {!isAuthorizedTestProjectConfigured() && <p className="text-xs text-amber-900">Import is disabled unless this build points to the authorized test project.</p>}
                  </>
                )}
              </>
            )}
            {staffImportReport && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-live="polite">
                <h3 className="font-semibold text-slate-950">Staff import result</h3>
                <p className="text-sm text-slate-700">{staffImportReport.imported} imported · {staffImportReport.alreadyImported} already imported · {staffImportReport.failed} need review. No attendance or payroll transactions were imported.</p>
                <ul className="space-y-2 text-sm">{staffImportReport.rows.map((row, index) => <li key={`${row.name}-${index}`} className="rounded-lg bg-white p-3"><span className="font-semibold text-slate-900">{row.name}: {row.status}.</span> <span className="text-slate-600">{row.message}</span></li>)}</ul>
              </div>
            )}
          </section>
        )}

        {activeExpensePreview && (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-950">Review legacy expenses</h2>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
                Each selected row is recorded as a historical expense in the shared ledger. Review the source,
                target institute and branch, and confirm it is not already present there. The database stores a
                source fingerprint and audit event, never the raw browser payload. Original browser data remains intact.
              </p>
            </div>
            {activeExpensePreview.issue && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{activeExpensePreview.issue}</p>}
            {!activeExpensePreview.issue && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">{eligibleExpenses.length} eligible</span>
                  <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800">{activeExpensePreview.candidates.length - eligibleExpenses.length} held for review</span>
                  {activeExpensePreview.candidates.length > 100 && <span className="text-slate-600">Imports run in batches of up to 100 records.</span>}
                </div>
                <p className="text-xs text-slate-500">Imported expenses are assigned to this institute workspace.</p>
                {activeExpensePreview.candidates.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[1050px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="w-12 p-3">Import</th><th className="p-3">Expense</th><th className="p-3">Amount / date</th><th className="p-3">Method / notes</th><th className="p-3">Review</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeExpensePreview.candidates.map((candidate) => (
                          <tr key={candidate.sourceRecordId} className={candidate.eligible ? "" : "bg-amber-50/50"}>
                            <td className="p-3"><input aria-label={`Select ${candidate.title} for expense import`} type="checkbox" checked={candidate.eligible && selectedExpenseIds.includes(candidate.sourceRecordId)} disabled={!candidate.eligible || busy !== null} onChange={(event) => setSelectedExpenseIds((current) => event.target.checked ? [...current, candidate.sourceRecordId] : current.filter((id) => id !== candidate.sourceRecordId))} /></td>
                            <td className="p-3"><span className="font-medium text-slate-950">{candidate.title}</span><span className="mt-0.5 block text-xs text-slate-600">{candidate.category || "No category"}</span><span className="mt-0.5 block font-mono text-[11px] text-slate-500">Source ID: {candidate.sourceRecordId}</span></td>
                            <td className="p-3 tabular-nums"><span className="block">{candidate.eligible ? formatPaise(candidate.amountPaise) : "Amount held"}</span><span className="mt-0.5 block text-xs text-slate-600">{candidate.expenseDate || "Date needs review"}</span></td>
                            <td className="p-3"><span className="block">{candidate.method || "Method needs review"}</span><span className="mt-0.5 block max-w-xs truncate text-xs text-slate-600">{candidate.notes || "No notes"}</span></td>
                            <td className="p-3">{candidate.eligible ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check size={14} />Ready for owner review</span> : <span className="text-xs leading-5 text-amber-900">{candidate.reason}</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No expense records were found in the legacy key.</p>}
                {eligibleExpenses.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSelectedExpenseIds(eligibleExpenses.slice(0, 100).map((candidate) => candidate.sourceRecordId))} disabled={busy !== null} className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Select first 100 eligible</button>
                      <button type="button" onClick={() => setSelectedExpenseIds([])} disabled={busy !== null} className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear selection</button>
                    </div>
                    <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
                      <input type="checkbox" checked={confirmHistoricalExpenses} onChange={(event) => setConfirmHistoricalExpenses(event.target.checked)} disabled={busy !== null} className="mt-1" />
                      <span>I reviewed each selected row, confirm each is a real historical business cost in INR, and confirm it is not already recorded in this institute ledger. Importing adds it to expenses and may affect historical reports. Original browser records will not be deleted or merged.</span>
                    </label>
                    <button type="button" onClick={() => void importSelectedExpenses()} disabled={busy !== null || selectedExpenseIds.length === 0 || !confirmHistoricalExpenses || !isAuthorizedTestProjectConfigured()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                      <Upload size={16} />{busy === "import" ? "Importing selected records..." : `Import ${Math.min(selectedExpenseIds.length, 100)} selected expense(s)`}
                    </button>
                    {!isAuthorizedTestProjectConfigured() && <p className="text-xs text-amber-900">Import is disabled unless this build points to the authorized test project.</p>}
                  </>
                )}
              </>
            )}
            {expenseImportReport && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-live="polite">
                <h3 className="font-semibold text-slate-950">Expense import result</h3>
                <p className="text-sm text-slate-700">{expenseImportReport.imported} imported · {expenseImportReport.alreadyImported} already imported · {expenseImportReport.failed} need review. Confirmed expense amount: {formatPaise(expenseImportReport.amountPaise)}.</p>
                <ul className="space-y-2 text-sm">{expenseImportReport.rows.map((row, index) => <li key={`${row.name}-${index}`} className="rounded-lg bg-white p-3"><span className="font-semibold text-slate-900">{row.name}: {row.status}.</span> <span className="text-slate-600">{row.message}</span></li>)}</ul>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
