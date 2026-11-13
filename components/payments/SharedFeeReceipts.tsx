"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Download, FileText, RefreshCw, Send } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import StudentFeeReceiptPreview from "@/components/payments/StudentFeeReceiptPreview";

type Delivery = { id: string; channel: "WhatsApp" | "Email"; delivery_status: string; retryable: boolean; last_error_code: string | null; sent_at: string | null };
type ReceiptPolicy = { delivery_channels: Array<"WhatsApp" | "Email">; template_title: string; accent_color: string; header_color: string; footer_note: string; terms_note: string; show_installment_schedule: boolean; show_payment_reference: boolean; show_institute_logo: boolean; show_bizbook_brand_mark: boolean; bizbook_brand_name: string; show_watermark?: boolean; watermark_size_percent?: number; watermark_opacity_percent?: number; watermark_logo_url?: string | null; title_bold?: boolean; title_pill?: boolean; show_paid_seal?: boolean; paid_seal_color?: string; paid_seal_opacity_percent?: number; paid_seal_size_percent?: number };
type Schedule = { installment_id: string; sequence_number: number; scheduled_amount: number; due_date: string | null; paid_amount: number; outstanding_amount: number; balance_status: string; paid_dates: string[] };
type Receipt = {
  id: string; institute_id: string; branch_id: string | null; student_id: string; payment_id: string; receipt_number: string; created_at: string;
  payment: { receipt_kind: string; amount: number; payment_date: string; method: string; status: string; provider_reference: string | null; note: string | null } | null;
  student: { id: string; name: string; parent_name: string | null; parent_email: string | null; parent_mobile: string | null; whatsapp: string | null } | null;
  deliveries: Delivery[]; schedule: Schedule[];
};
type Institute = { business_name: string; owner_name: string | null; phone: string | null; whatsapp: string | null; email: string | null; website: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; gstin: string | null; logo_url: string | null };
type ReceiptResponse = { institute?: Institute; receipts?: Receipt[]; policy?: ReceiptPolicy; error?: string; warning?: string };

const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
const defaultPreviewPolicy: ReceiptPolicy = {
  delivery_channels: [], template_title: "Fee Payment Receipt", accent_color: "#166534", header_color: "#166534",
  footer_note: "Thank you for your payment.", terms_note: "This receipt confirms payment received. Keep it for your records.",
  show_installment_schedule: true, show_payment_reference: true, show_institute_logo: true,
  show_bizbook_brand_mark: true, bizbook_brand_name: "BizBook", show_watermark: false,
  watermark_size_percent: 42, watermark_opacity_percent: 8, watermark_logo_url: null,
  title_bold: true, title_pill: false, show_paid_seal: true, paid_seal_color: "#B91C1C",
  paid_seal_opacity_percent: 70, paid_seal_size_percent: 100,
};
const displayDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
};
const statusText = (status: string | undefined) => {
  if (!status) return "Not selected";
  if (status === "Sent") return "Sent";
  if (status === "Queued" || status === "Processing") return "Pending";
  if (status === "Failed") return "Failed";
  if (status === "Unknown") return "Check provider";
  if (status === "Skipped") return "Skipped";
  return status;
};

export default function SharedFeeReceipts() {
  const scope = useWorkspaceScope();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [institute, setInstitute] = useState<Institute | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [policy, setPolicy] = useState<ReceiptPolicy | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selection = scope.selection;
  const scopedInstitute = scope.institutes.find((item) => item.id === selection?.instituteId);
  const previewInstitute: Institute | null = institute ?? (scopedInstitute ? {
    business_name: scopedInstitute.name, owner_name: null, phone: null, whatsapp: null,
    email: null, website: null, address: null, city: null, state: null, pincode: null,
    gstin: null, logo_url: null,
  } : selection?.instituteId ? {
    business_name: "Your coaching institute", owner_name: null, phone: null, whatsapp: null,
    email: null, website: null, address: null, city: null, state: null, pincode: null,
    gstin: null, logo_url: null,
  } : null);

  const refresh = useCallback(async () => {
    if (!selection?.instituteId) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ instituteId: selection.instituteId });
      if (selection.branchId) query.set("branchId", selection.branchId);
      const response = await fetch(`/api/payments/receipts?${query}`, { cache: "no-store" });
      const result = await response.json() as ReceiptResponse;
      if (!response.ok) throw new Error(result.error || "Fee receipts could not be loaded.");
      const rows = result.receipts ?? [];
      setInstitute(result.institute ?? null);
      setPolicy(result.policy ?? null);
      setReceipts(rows);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? "");
      setError(result.warning ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fee receipts could not be loaded.");
    } finally { setLoading(false); }
  }, [selection?.branchId, selection?.instituteId]);

  useEffect(() => {
    if (!selection?.instituteId) {
      setReceipts([]);
      setInstitute(null);
      setSelectedId("");
      return;
    }
    void refresh();
  }, [refresh, selection?.instituteId]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);
  const selected = useMemo(() => receipts.find((item) => item.id === selectedId) ?? null, [receipts, selectedId]);
  async function sendReceipt(receipt: Receipt) {
    setSendingId(receipt.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/payments/receipts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId: receipt.id }),
      });
      const result = await response.json() as { error?: string; delivered?: Array<{ channel: string; status: string }> };
      if (!response.ok) throw new Error(result.error || "Receipt delivery could not be started.");
      const parts = (result.delivered ?? []).map((item) => `${item.channel}: ${statusText(item.status)}`);
      setNotice(parts.length ? parts.join(" · ") : "Receipt delivery is queued.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Receipt delivery could not be started.");
    } finally { setSendingId(""); }
  }

  const deliveryFor = (receipt: Receipt, selectedChannel: "WhatsApp" | "Email") => receipt.deliveries.find((item) => item.channel === selectedChannel);

  return (
    <WorkspaceLayout>
      <main className="mx-auto max-w-7xl space-y-4 px-3 pb-8 pt-20 sm:px-5 lg:px-7">
        <header className="relative isolate overflow-hidden rounded-[18px] bg-gradient-to-r from-[#123b5a] via-[#2563a6] to-[#5b3aa8] px-4 py-3 text-white shadow-[0_16px_38px_-26px_rgba(37,99,166,.75)] sm:rounded-3xl sm:px-5 sm:py-4">
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 size-52 rounded-full border border-white/15 bg-white/[0.05]" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-28 size-40 rounded-full border border-white/10" />
          <div className="relative z-10 flex flex-row items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/10 text-white"><FileText size={19} /></span>
              <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.15em] text-cyan-100 sm:text-[10px]">Payments & collections</p><h1 className="mt-1 truncate text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">Fee receipts & invoices</h1><p className="mt-0.5 hidden text-xs text-blue-100 sm:block sm:text-sm">Preview and send receipts. The receipt template is managed by BizBook.</p></div>
            </div>
            <button type="button" onClick={() => void refresh()} disabled={loading || !selection?.instituteId} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-cyan-50 disabled:opacity-60 sm:min-h-10 sm:rounded-xl sm:px-3.5 sm:text-sm"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
          <div className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-2.5 text-[10px] sm:text-xs"><p className="text-blue-100">Preview a paid receipt, or view the sample before the first payment.</p><span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-blue-50"><CalendarClock size={12} /> PDF receipts</span></div>
        </header>

        <section aria-label="Receipt delivery" className="flex flex-col gap-3 rounded-xl border border-violet-100 bg-gradient-to-r from-violet-50 via-white to-indigo-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">Receipt delivery</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">Managed by BizBook · {policy?.delivery_channels.length ? policy.delivery_channels.join(" + ") : "Sending paused"}. Family consent is required. Only BizBook can change the template and delivery settings.</p>
          </div>
          <Link href="/business/students" className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:border-violet-400 hover:bg-violet-50">Manage family consent</Link>
        </section>

        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)] lg:gap-5">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-gradient-to-r from-violet-50 to-white p-4"><h2 className="text-sm font-bold text-slate-900">Paid fee receipts</h2><p className="mt-1 text-xs text-slate-500">{receipts.length} receipt{receipts.length === 1 ? "" : "s"} in this workspace</p></div>
            {error && <div role="alert" className="m-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}<button type="button" onClick={() => void refresh()} className="ml-2 font-bold underline">Retry</button></div>}
            {loading && !receipts.length ? <p className="p-5 text-sm text-slate-500">Loading paid receipts…</p> : !receipts.length ? <div className="p-6 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-violet-50 text-violet-700"><FileText size={20} /></span><p className="mt-3 text-sm font-bold text-slate-900">No paid fee receipts yet</p><p className="mt-1 text-xs leading-5 text-slate-500">A PDF receipt appears automatically after a fee payment is recorded or verified.</p></div> : <div className="max-h-[68vh] divide-y divide-slate-100 overflow-y-auto">{receipts.map((receipt) => {
              const payment = receipt.payment;
              const whatsApp = deliveryFor(receipt, "WhatsApp");
              const email = deliveryFor(receipt, "Email");
              const active = selectedId === receipt.id;
              const deliveryStatuses: Array<{ label: string; item?: Delivery }> = (policy?.delivery_channels ?? []).map((channel) => ({
                label: channel,
                item: channel === "WhatsApp" ? whatsApp : email,
              }));
              return <button key={receipt.id} type="button" onClick={() => setSelectedId(receipt.id)} className={`block w-full px-4 py-3.5 text-left transition ${active ? "bg-violet-50/80" : "hover:bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate text-sm font-bold text-slate-900">{receipt.student?.name ?? "Student"}</span><span className="mt-0.5 block truncate text-[11px] text-slate-500">{receipt.receipt_number} · {displayDate(payment?.payment_date)}</span></span><strong className="shrink-0 text-sm text-slate-900">{money(Number(payment?.amount ?? 0))}</strong></div>
                <div className="mt-2 flex flex-wrap gap-1.5">{deliveryStatuses.length ? deliveryStatuses.map(({ label, item }) => {
                  const status = item?.delivery_status ?? "Ready";
                  return <span key={label} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status === "Sent" ? "bg-emerald-100 text-emerald-800" : status === "Failed" || status === "Unknown" ? "bg-rose-100 text-rose-800" : status === "Ready" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}>{label}: {status === "Ready" ? "Ready to send" : statusText(status)}</span>;
                }) : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Delivery paused</span>}</div>
              </button>;
            })}</div>}
          </section>

          <div className="min-w-0 space-y-3">
            {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">{notice}</p>}
            {selected && selected.payment && selected.student && institute ? <>
              <div className="flex flex-col gap-3 rounded-2xl border border-violet-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-sm font-bold text-slate-900">Send this receipt PDF</p><p className="mt-1 text-xs text-slate-500">BizBook sets the delivery channels. Institute staff can send receipts through enabled channels, but cannot change the template or delivery settings.</p></div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {policy?.delivery_channels.length ? <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-900">{policy.delivery_channels.join(" + ")}</span> : <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">Delivery paused</span>}
                  <button type="button" onClick={() => void sendReceipt(selected)} disabled={sendingId === selected.id || !policy?.delivery_channels.length} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-bold text-white shadow-sm hover:bg-violet-800 disabled:opacity-50"><Send size={15} />{sendingId === selected.id ? "Sending…" : "Send receipt"}</button>
                </div>
              </div>

              <div className="px-1"><h2 className="text-sm font-bold text-slate-900">PDF receipt preview</h2><p className="mt-0.5 text-xs text-slate-500">The PDF uses your institute details, payment record, and the company logo selected for the watermark.</p></div>
              <StudentFeeReceiptPreview policy={policy ?? defaultPreviewPolicy} institute={institute} receipt={{ receipt_number: selected.receipt_number, amount: Number(selected.payment.amount), payment_date: selected.payment.payment_date, method: selected.payment.method, reference: selected.payment.provider_reference, status: selected.payment.status, student_name: selected.student.name, parent_name: selected.student.parent_name, schedule: selected.schedule }} />
              <a href={"/api/payments/receipts/" + encodeURIComponent(selected.id) + "/pdf"} target="_blank" rel="noreferrer" className="mx-auto inline-flex min-h-8 items-center justify-center gap-1 rounded-md border border-emerald-200 bg-white px-2 text-[10px] font-bold text-emerald-900 hover:bg-emerald-50"><Download size={14} />Preview / download PDF</a>
            </> : !loading && previewInstitute ? <>
              <div className="px-1"><h2 className="text-sm font-bold text-slate-900">Receipt template preview</h2><p className="mt-0.5 text-xs text-slate-500">Sample only. The actual receipt fills in the student, payment, installment, and delivery details.</p></div>
              <StudentFeeReceiptPreview policy={policy ?? defaultPreviewPolicy} institute={previewInstitute} sample />
              <p className="mx-auto max-w-[340px] text-[10px] leading-4 text-slate-500">A real receipt appears after a payment is recorded. BizBook controls the locked template and delivery settings.</p>
            </> : null}
          </div>
        </div>
      </main>
    </WorkspaceLayout>
  );
}
