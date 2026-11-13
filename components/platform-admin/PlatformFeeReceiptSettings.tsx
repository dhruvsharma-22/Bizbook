"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Building2, Check, CornerDownLeft, FileText, LoaderCircle, Save } from "lucide-react";
import StudentFeeReceiptPreview from "@/components/payments/StudentFeeReceiptPreview";

type Channel = "WhatsApp" | "Email";
type Policy = {
  delivery_channels: Channel[];
  template_title: string;
  accent_color: string;
  header_color: string;
  footer_note: string;
  terms_note: string;
  show_installment_schedule: boolean;
  show_payment_reference: boolean;
  show_institute_logo: boolean;
  show_bizbook_brand_mark: boolean;
  bizbook_brand_name: string;
  show_watermark: boolean;
  watermark_size_percent: number;
  watermark_opacity_percent: number;
  watermark_logo_url: string | null;
  title_bold: boolean;
  title_pill: boolean;
  show_paid_seal: boolean;
  paid_seal_color: string;
  paid_seal_opacity_percent: number;
  paid_seal_size_percent: number;
  updated_at?: string;
};
type ResponseBody = { policy?: Policy; error?: string; watermark_logo_url?: string | null; saved?: boolean };

const initial: Policy = {
  delivery_channels: ["WhatsApp"],
  template_title: "Fee Payment Receipt",
  accent_color: "#166534",
  header_color: "#166534",
  footer_note: "Thank you for your payment.",
  terms_note: "This receipt confirms payment received. Any remaining installment balance is due by its scheduled date. Please keep this receipt for your records.",
  show_installment_schedule: true,
  show_payment_reference: true,
  show_institute_logo: true,
  show_bizbook_brand_mark: true,
  bizbook_brand_name: "BizBook",
  show_watermark: true,
  watermark_size_percent: 42,
  watermark_opacity_percent: 8,
  watermark_logo_url: null,
  title_bold: true,
  title_pill: false,
  show_paid_seal: true,
  paid_seal_color: "#B91C1C",
  paid_seal_opacity_percent: 70,
  paid_seal_size_percent: 100,
};
const inputClass = "mt-1.5 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100";

async function compressWatermarkLogo(file: File): Promise<File> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Choose a PNG, JPG, or WebP image.");
  }
  const bitmap = await createImageBitmap(file);
  const preserveTransparency = file.type === "image/png" || file.type === "image/webp";
  const outputType = preserveTransparency ? "image/png" : "image/jpeg";
  const maxBytes = 8 * 1024 * 1024;
  let scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  let quality = 0.86;

  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The image could not be prepared for upload.");
      if (!preserveTransparency) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, quality));
      if (blob && blob.size <= maxBytes) {
        const extension = preserveTransparency ? "png" : "jpg";
        return new File([blob], `company-watermark.${extension}`, { type: outputType, lastModified: Date.now() });
      }
      scale *= 0.78;
      quality = Math.max(0.55, quality - 0.06);
    }
  } finally {
    bitmap.close();
  }
  throw new Error("This image could not be compressed enough. Choose a simpler or smaller logo image.");
}

export default function PlatformFeeReceiptSettings() {
  const [policy, setPolicy] = useState<Policy>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const termsRef = useRef<HTMLTextAreaElement>(null);
  const watermarkFileRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/platform-admin/fee-receipt-policy", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as ResponseBody;
        if (!response.ok || !result.policy) throw new Error(result.error || "Receipt settings could not be loaded.");
        if (active) setPolicy(result.policy);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Receipt settings could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function update<K extends keyof Policy>(key: K, value: Policy[K]) {
    setPolicy((current) => ({ ...current, [key]: value }));
    setNotice("");
  }

  function toggleChannel(channel: Channel) {
    update("delivery_channels", policy.delivery_channels.includes(channel)
      ? policy.delivery_channels.filter((item) => item !== channel)
      : [...policy.delivery_channels, channel]);
  }

  function insertTitleLineBreak() {
    const input = titleRef.current;
    const start = input?.selectionStart ?? policy.template_title.length;
    const end = input?.selectionEnd ?? policy.template_title.length;
    const before = policy.template_title.slice(0, start);
    const after = policy.template_title.slice(end);
    if (`${before}\n${after}`.split(/\r?\n/).filter(Boolean).length > 2) return;
    const next = `${before}\n${after}`;
    update("template_title", next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + 1, start + 1);
    });
  }

  function insertTermsLineBreak() {
    const input = termsRef.current;
    const start = input?.selectionStart ?? policy.terms_note.length;
    const end = input?.selectionEnd ?? policy.terms_note.length;
    const next = `${policy.terms_note.slice(0, start)}\n${policy.terms_note.slice(end)}`;
    if (next.length > 360 || next.split(/\r?\n/).length > 4) return;
    update("terms_note", next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + 1, start + 1);
    });
  }

  async function save() {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform-admin/fee-receipt-policy", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delivery_channels: policy.delivery_channels,
          template_title: policy.template_title,
          accent_color: policy.accent_color,
          header_color: policy.header_color,
          footer_note: policy.footer_note,
          terms_note: policy.terms_note,
          show_watermark: policy.show_watermark,
          watermark_size_percent: policy.watermark_size_percent,
          watermark_opacity_percent: policy.watermark_opacity_percent,
          title_bold: policy.title_bold,
          title_pill: policy.title_pill,
          show_paid_seal: policy.show_paid_seal,
          paid_seal_color: policy.paid_seal_color,
          paid_seal_opacity_percent: policy.paid_seal_opacity_percent,
          paid_seal_size_percent: policy.paid_seal_size_percent,
          show_installment_schedule: true,
          show_payment_reference: policy.show_payment_reference,
          show_institute_logo: policy.show_institute_logo,
          show_bizbook_brand_mark: policy.show_bizbook_brand_mark,
          bizbook_brand_name: policy.bizbook_brand_name,
        }),
      });
      const result = await response.json() as ResponseBody;
      if (!response.ok || !result.policy) throw new Error(result.error || "Receipt settings could not be saved.");
      setPolicy({ ...result.policy, watermark_logo_url: result.policy.watermark_logo_url ?? policy.watermark_logo_url });
      setNotice("Student fee receipt template and delivery policy saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Receipt settings could not be saved.");
    } finally { setSaving(false); }
  }

  async function uploadWatermarkLogo(file: File | undefined) {
    if (!file) return;
    setError(""); setNotice(""); setUploadingLogo(true);
    const previousUrl = policy.watermark_logo_url;
    const previewUrl = URL.createObjectURL(file);
    setPolicy((current) => ({ ...current, watermark_logo_url: previewUrl, show_watermark: true }));
    try {
      const compressed = await compressWatermarkLogo(file);
      const form = new FormData();
      form.append("logo", compressed);
      const response = await fetch("/api/platform-admin/fee-receipt-policy", { method: "POST", body: form });
      const result = await response.json() as ResponseBody;
      if (!response.ok) throw new Error(result.error || "The company logo could not be uploaded.");
      setPolicy((current) => ({ ...current, watermark_logo_url: result.watermark_logo_url ?? previewUrl, show_watermark: true }));
      setNotice("Company logo uploaded and added as the receipt watermark.");
    } catch (reason) {
      setPolicy((current) => current.watermark_logo_url === previewUrl ? { ...current, watermark_logo_url: previousUrl } : current);
      setError(reason instanceof Error ? reason.message : "The company logo could not be uploaded.");
    } finally {
      URL.revokeObjectURL(previewUrl);
      setUploadingLogo(false);
      if (watermarkFileRef.current) watermarkFileRef.current.value = "";
    }
  }

  async function removeWatermarkLogo() {
    setError(""); setNotice(""); setUploadingLogo(true);
    try {
      const response = await fetch("/api/platform-admin/fee-receipt-policy", { method: "DELETE" });
      const result = await response.json() as ResponseBody;
      if (!response.ok) throw new Error(result.error || "The company logo could not be removed.");
      setPolicy((current) => ({ ...current, watermark_logo_url: null }));
      setNotice("Company watermark logo removed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The company logo could not be removed.");
    } finally { setUploadingLogo(false); }
  }

  const disabled = loading || saving;
  const selectedChannels = policy.delivery_channels.length ? policy.delivery_channels.join(" + ") : "Delivery paused";

  return (
    <section id="student-fee-receipt-template" className="scroll-mt-28 overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-800"><FileText size={18} /></span>
          <div><p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-violet-800">Company controlled · student payments</p><h2 className="mt-1 text-base font-extrabold tracking-tight text-slate-950">Student fee receipt template</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">Design the one-page receipt and choose how it reaches families. Subscription invoices are separate.</p></div>
        </div>
        {policy.updated_at && <span className="text-[10px] text-slate-500">Updated {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(policy.updated_at))}</span>}
      </header>

      <div className="grid items-start gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-800">{error}</p>}
          {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-800">{notice}</p>}

          <fieldset disabled={disabled} className="rounded-xl border border-slate-200 bg-white p-3 disabled:opacity-70">
            <legend className="px-1 text-xs font-extrabold text-slate-900">Delivery channels</legend>
            <p className="mb-2 text-[11px] leading-4 text-slate-600">Company-wide choice. Guardian consent and an enabled sender are still required.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["WhatsApp", "Email"] as const).map((channel) => <label key={channel} className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-xs font-bold transition ${policy.delivery_channels.includes(channel) ? "border-violet-300 bg-violet-50 text-violet-950" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                <input type="checkbox" checked={policy.delivery_channels.includes(channel)} onChange={() => toggleChannel(channel)} className="size-4 accent-violet-700" />{channel}
              </label>)}
            </div>
            {!policy.delivery_channels.length && <p className="mt-2 text-[11px] font-semibold text-amber-800">No channel selected: automatic delivery is paused.</p>}
          </fieldset>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="block text-[11px] font-bold text-slate-700 sm:col-span-2">Receipt heading<textarea ref={titleRef} className={`${inputClass} min-h-[64px] resize-y py-2`} maxLength={64} value={policy.template_title} disabled={disabled} onChange={(event) => update("template_title", event.target.value.replace(/\r/g, "").split("\n").slice(0, 2).join("\n"))} /></label>
            <label className="block text-[11px] font-bold text-slate-700">Accent color<span className="mt-1.5 flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2"><input aria-label="Receipt accent color" type="color" value={policy.accent_color} disabled={disabled} onChange={(event) => update("accent_color", event.target.value)} className="size-7 cursor-pointer rounded border-0 bg-transparent p-0" /><span className="font-mono text-[10px] font-semibold text-slate-700">{policy.accent_color.toUpperCase()}</span></span></label>
            <label className="block text-[11px] font-bold text-slate-700">Header color<span className="mt-1.5 flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2"><input aria-label="Receipt header color" type="color" value={policy.header_color} disabled={disabled} onChange={(event) => update("header_color", event.target.value)} className="size-7 cursor-pointer rounded border-0 bg-transparent p-0" /><span className="font-mono text-[10px] font-semibold text-slate-700">{policy.header_color.toUpperCase()}</span></span></label>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
            <span className="mr-1 text-[10px] font-bold text-slate-600">Heading style</span>
            <button type="button" disabled={disabled} onClick={() => update("title_bold", !policy.title_bold)} aria-pressed={policy.title_bold} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold ${policy.title_bold ? "border-violet-300 bg-violet-100 text-violet-900" : "border-slate-200 bg-white text-slate-700"}`}><Bold size={14} />Bold</button>
            <button type="button" disabled={disabled} onClick={insertTitleLineBreak} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-700"><CornerDownLeft size={14} />New line</button>
            <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700"><input type="checkbox" checked={policy.title_pill} disabled={disabled} onChange={(event) => update("title_pill", event.target.checked)} className="size-3.5 accent-violet-700" />Rounded title seal</label>
          </div>

          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-extrabold text-slate-800">Brand marks</p>
            <label className="flex items-start gap-2 text-[11px] text-slate-700"><input type="checkbox" checked={policy.show_institute_logo} disabled={disabled} onChange={(event) => update("show_institute_logo", event.target.checked)} className="mt-0.5 size-4 accent-violet-700" /><span>Show institute logo saved in its Business Profile</span></label>
            <label className="flex items-start gap-2 text-[11px] text-slate-700"><input type="checkbox" checked={policy.show_watermark} disabled={disabled} onChange={(event) => update("show_watermark", event.target.checked)} className="mt-0.5 size-4 accent-violet-700" /><span>Use your uploaded company logo as a light watermark on the receipt</span></label>
            <div className="grid gap-3 pl-6 sm:grid-cols-2">
              <label className="block text-[10px] font-semibold text-slate-600">Watermark size · {policy.watermark_size_percent}%<input type="range" min={15} max={75} step={1} value={policy.watermark_size_percent} disabled={disabled || !policy.show_watermark} onChange={(event) => update("watermark_size_percent", Number(event.target.value))} className="mt-2 block w-full accent-violet-700" /></label>
              <label className="block text-[10px] font-semibold text-slate-600">Watermark strength · {policy.watermark_opacity_percent}%<input type="range" min={3} max={22} step={1} value={policy.watermark_opacity_percent} disabled={disabled || !policy.show_watermark} onChange={(event) => update("watermark_opacity_percent", Number(event.target.value))} className="mt-2 block w-full accent-violet-700" /></label>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-2.5">
              <input ref={watermarkFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Choose company watermark logo" onChange={(event) => void uploadWatermarkLogo(event.target.files?.[0])} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">{policy.watermark_logo_url ? <img src={policy.watermark_logo_url} alt="Company watermark logo" className="size-10 rounded-md border border-slate-200 bg-white object-contain p-1" /> : <span className="grid size-10 shrink-0 place-items-center rounded-md border border-dashed border-emerald-300 bg-white text-emerald-700"><Building2 size={17} /></span>}<span className="text-[10px] font-semibold text-slate-700">{policy.watermark_logo_url ? "Custom company logo saved" : "Choose the company logo for the watermark"}</span></div>
                <div className="flex gap-1.5"><button type="button" disabled={uploadingLogo || disabled} onClick={() => watermarkFileRef.current?.click()} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 text-[10px] font-bold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50">{uploadingLogo ? "Compressing & uploading…" : policy.watermark_logo_url ? "Replace logo" : "Choose logo"}</button>{policy.watermark_logo_url && <button type="button" disabled={uploadingLogo || disabled} onClick={() => void removeWatermarkLogo()} aria-label="Remove watermark logo" className="min-h-8 rounded-lg border border-rose-200 bg-white px-2 text-[10px] font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Remove</button>}</div>
              </div>
              <p className="mt-1 text-[9px] leading-4 text-slate-500">PNG, JPG, or WebP. Large images are resized and compressed automatically.</p>
            </div>
            <label className="flex items-start gap-2 text-[11px] text-slate-700"><input type="checkbox" checked={policy.show_bizbook_brand_mark} disabled={disabled} onChange={(event) => update("show_bizbook_brand_mark", event.target.checked)} className="mt-0.5 size-4 accent-violet-700" /><span>Show BizBook brand mark</span></label>
            <label className="block text-[11px] font-bold text-slate-700">BizBook mark name<input className={inputClass} maxLength={48} value={policy.bizbook_brand_name} disabled={disabled || !policy.show_bizbook_brand_mark} onChange={(event) => update("bizbook_brand_name", event.target.value)} /></label>
          </section>

          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-extrabold text-slate-800">Payment seal</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[11px] text-slate-700"><input type="checkbox" checked={policy.show_paid_seal} disabled={disabled} onChange={(event) => update("show_paid_seal", event.target.checked)} className="size-4 accent-violet-700" />Show the PAID seal below the amount</label>
              <label className={`flex items-center gap-2 text-[10px] font-semibold text-slate-600 ${!policy.show_paid_seal ? "opacity-50" : ""}`}>Seal color<input aria-label="Paid seal color" type="color" value={policy.paid_seal_color} disabled={disabled || !policy.show_paid_seal} onChange={(event) => update("paid_seal_color", event.target.value)} className="size-8 cursor-pointer rounded border border-slate-200 bg-white p-0.5" /></label>
            </div>
            <label className={`block text-[10px] font-semibold text-slate-600 ${!policy.show_paid_seal ? "opacity-50" : ""}`}>Seal transparency · {100 - policy.paid_seal_opacity_percent}%<input type="range" min={0} max={100} step={1} value={100 - policy.paid_seal_opacity_percent} disabled={disabled || !policy.show_paid_seal} onChange={(event) => update("paid_seal_opacity_percent", 100 - Number(event.target.value))} className="mt-2 block w-full accent-violet-700" /></label>
            <label className={`block text-[10px] font-semibold text-slate-600 ${!policy.show_paid_seal ? "opacity-50" : ""}`}>Seal size · {policy.paid_seal_size_percent}%<input type="range" min={60} max={160} step={5} value={policy.paid_seal_size_percent} disabled={disabled || !policy.show_paid_seal} onChange={(event) => update("paid_seal_size_percent", Number(event.target.value))} className="mt-2 block w-full accent-violet-700" /></label>
            <p className="text-[10px] leading-4 text-slate-500">The PAID seal stays fixed on its own line below the amount and above the payment details.</p>
            <p className="text-[10px] leading-4 text-slate-500">The seal appears only on receipts for fully paid transactions.</p>
          </section>

          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-extrabold text-slate-800">Include in receipt</p>
            <p className="flex items-start gap-2 text-[11px] text-slate-700"><Check size={14} className="mt-0.5 shrink-0 text-emerald-700" /><span>Every installment, paid amount/date, and outstanding balance always appears.</span></p>
            <label className="flex items-start gap-2 text-[11px] text-slate-700"><input type="checkbox" checked={policy.show_payment_reference} disabled={disabled} onChange={(event) => update("show_payment_reference", event.target.checked)} className="mt-0.5 size-4 accent-violet-700" /><span>Show payment reference number</span></label>
          </section>

          <label className="block text-[11px] font-bold text-slate-700">Terms and conditions<span className="mt-1.5 flex flex-wrap items-center gap-2 rounded-t-xl border border-slate-200 bg-slate-50 p-2"><button type="button" disabled={disabled || policy.terms_note.length >= 360 || policy.terms_note.split(/\r?\n/).length >= 4} onClick={insertTermsLineBreak} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"><CornerDownLeft size={14} />New line</button><span className="text-[10px] font-normal text-slate-500">Adds a line break at the cursor</span></span><textarea ref={termsRef} className={`${inputClass} mt-0 min-h-[76px] rounded-t-none py-2`} maxLength={360} value={policy.terms_note} disabled={disabled} onChange={(event) => update("terms_note", event.target.value)} /><span className="mt-1 block font-normal text-slate-500">Up to 360 characters · shown on the receipt.</span></label>
          <label className="block text-[11px] font-bold text-slate-700">Footer note<textarea className={`${inputClass} min-h-[58px] py-2`} maxLength={160} value={policy.footer_note} disabled={disabled} onChange={(event) => update("footer_note", event.target.value)} /></label>

          <button type="button" onClick={() => void save()} disabled={disabled} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-violet-800 px-4 text-xs font-extrabold text-white shadow-sm transition hover:bg-violet-900 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}{saving ? "Saving template…" : "Save receipt template"}
          </button>
        </div>

        <div className="lg:sticky lg:top-24">
          <p className="mb-2 flex items-center justify-between gap-2 text-[10px] font-extrabold uppercase tracking-wide text-slate-600"><span>A4 · one-page preview</span><span className="rounded-full bg-violet-50 px-2.5 py-1 normal-case tracking-normal text-violet-800">{selectedChannels}</span></p>
          <StudentFeeReceiptPreview policy={policy} institute={{ business_name: "Institute name", address: "Institute address and contact", gstin: null }} sample />
          <p className="mx-auto mt-2 max-w-[390px] text-[10px] leading-4 text-slate-500">The uploaded company logo is used as the watermark. Coaches can preview this locked template.</p>
        </div>
      </div>
    </section>
  );
}
