import "server-only";

import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createSupabaseAdminClient } from "./admin";
import { parseActiveFeeReceiptCredentials } from "./notification-provider-credentials";
import type { TablesUpdate } from "./database.types";

export type ReceiptChannel = "WhatsApp" | "Email";
export type FeeReceiptPolicy = {
  delivery_channels: ReceiptChannel[];
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

const WATERMARK_BUCKET = "bizbook-company-brand-assets";

type ReceiptBundle = {
  receipt: {
    id: string; institute_id: string; branch_id: string | null; student_id: string;
    payment_id: string; receipt_number: string; created_at: string;
  };
  payment: {
    amount: number; payment_date: string; method: string; status: string;
    provider_reference: string | null; note: string | null;
  };
  student: {
    name: string; parent_name: string | null; parent_email: string | null;
    parent_mobile: string | null; whatsapp: string | null;
    email_receipt_opt_in: boolean; whatsapp_receipt_opt_in: boolean;
  };
  institute: {
    business_name: string; owner_name: string | null; phone: string | null; whatsapp: string | null;
    email: string | null; website: string | null; address: string | null; city: string | null;
    state: string | null; pincode: string | null; gstin: string | null; logo_path: string | null;
  };
  schedule: Array<{
    installment_id: string; sequence_number: number; scheduled_amount: number; due_date: string | null;
    paid_amount: number; outstanding_amount: number; balance_status: string;
  }>;
  paidDates: Map<string, string[]>;
};

export class FeeReceiptDeliveryError extends Error {
  constructor(message: string, public readonly safeCode: string, public readonly retryable: boolean, public readonly unknownOutcome = false) {
    super(message);
    this.name = "FeeReceiptDeliveryError";
  }
}

const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (value: number) => `INR ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}`;
const colorFromHex = (value: string) => {
  const hex = value.replace(/^#/, "");
  return rgb(Number.parseInt(hex.slice(0, 2), 16) / 255, Number.parseInt(hex.slice(2, 4), 16) / 255, Number.parseInt(hex.slice(4, 6), 16) / 255);
};
const tintColor = (value: string) => {
  const hex = value.replace(/^#/, "");
  const channels = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  return rgb(...channels.map((channel) => 0.94 + channel * 0.06) as [number, number, number]);
};
const dateLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(date);
};

export async function loadPlatformFeeReceiptPolicy(): Promise<FeeReceiptPolicy> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("platform_fee_receipt_policy")
    .select("delivery_channels, template_title, accent_color, header_color, footer_note, terms_note, show_installment_schedule, show_payment_reference, show_institute_logo, show_bizbook_brand_mark, bizbook_brand_name, show_watermark, watermark_size_percent, watermark_opacity_percent, watermark_logo_path, title_bold, title_pill, show_paid_seal, paid_seal_color, paid_seal_opacity_percent, paid_seal_size_percent, updated_at")
    .eq("id", true).maybeSingle();
  if (error || !data || !Array.isArray(data.delivery_channels)
    || data.delivery_channels.some((channel) => channel !== "WhatsApp" && channel !== "Email")
    || !/^#[\da-fA-F]{6}$/.test(data.accent_color)
    || !/^#[\da-fA-F]{6}$/.test(data.header_color)
    || typeof data.show_institute_logo !== "boolean" || typeof data.show_bizbook_brand_mark !== "boolean"
    || typeof data.bizbook_brand_name !== "string" || typeof data.terms_note !== "string"
    || typeof data.show_watermark !== "boolean" || typeof data.watermark_size_percent !== "number"
    || data.watermark_size_percent < 15 || data.watermark_size_percent > 75
    || typeof data.watermark_opacity_percent !== "number" || data.watermark_opacity_percent < 3 || data.watermark_opacity_percent > 22
    || typeof data.title_bold !== "boolean" || typeof data.title_pill !== "boolean"
    || typeof data.show_paid_seal !== "boolean" || !/^#[\da-fA-F]{6}$/.test(data.paid_seal_color)
    || typeof data.paid_seal_opacity_percent !== "number" || data.paid_seal_opacity_percent < 0 || data.paid_seal_opacity_percent > 100
    || typeof data.paid_seal_size_percent !== "number" || data.paid_seal_size_percent < 60 || data.paid_seal_size_percent > 160) {
    throw new FeeReceiptDeliveryError("Company fee receipt settings are unavailable.", "receipt_policy_unavailable", true);
  }
  let watermarkLogoUrl: string | null = null;
  if (data.watermark_logo_path) {
    const { data: signed, error: signedError } = await admin.storage.from(WATERMARK_BUCKET).createSignedUrl(data.watermark_logo_path, 3600);
    if (!signedError) watermarkLogoUrl = signed?.signedUrl ?? null;
  }
  return {
    delivery_channels: data.delivery_channels as ReceiptChannel[],
    template_title: data.template_title,
    accent_color: data.accent_color,
    header_color: data.header_color,
    footer_note: data.footer_note,
    terms_note: data.terms_note,
    show_installment_schedule: true,
    show_payment_reference: data.show_payment_reference,
    show_institute_logo: data.show_institute_logo,
    show_bizbook_brand_mark: data.show_bizbook_brand_mark,
    bizbook_brand_name: data.bizbook_brand_name,
    show_watermark: data.show_watermark,
    watermark_size_percent: data.watermark_size_percent,
    watermark_opacity_percent: data.watermark_opacity_percent,
    watermark_logo_url: watermarkLogoUrl,
    title_bold: data.title_bold,
    title_pill: data.title_pill,
    show_paid_seal: data.show_paid_seal,
    paid_seal_color: data.paid_seal_color,
    paid_seal_opacity_percent: data.paid_seal_opacity_percent,
    paid_seal_size_percent: data.paid_seal_size_percent,
    updated_at: data.updated_at,
  };
}

async function loadReceiptBundle(receiptId: string): Promise<ReceiptBundle> {
  const admin = createSupabaseAdminClient();
  const { data: receipt, error: receiptError } = await admin.from("fee_receipts").select("*").eq("id", receiptId).maybeSingle();
  if (receiptError || !receipt) throw new Error("The fee receipt could not be loaded.");
  const [paymentResult, studentResult, instituteResult, balancesResult, allocationResult] = await Promise.all([
    admin.from("payments").select("amount, payment_date, method, status, provider_reference, note")
      .eq("id", receipt.payment_id).eq("institute_id", receipt.institute_id).maybeSingle(),
    admin.from("students").select("name, parent_name, parent_email, parent_mobile, whatsapp, email_receipt_opt_in, whatsapp_receipt_opt_in")
      .eq("id", receipt.student_id).eq("institute_id", receipt.institute_id).maybeSingle(),
    admin.from("coaching_institutes").select("business_name, owner_name, phone, whatsapp, email, website, address, city, state, pincode, gstin, logo_path")
      .eq("id", receipt.institute_id).maybeSingle(),
    admin.from("installment_balances").select("installment_id, sequence_number, scheduled_amount, due_date, paid_amount, outstanding_amount, balance_status")
      .eq("institute_id", receipt.institute_id).eq("student_id", receipt.student_id).neq("balance_status", "Cancelled")
      .order("sequence_number", { ascending: true }),
    admin.from("payment_allocations").select("installment_id, payment_id, amount")
      .eq("institute_id", receipt.institute_id).eq("student_id", receipt.student_id).eq("allocation_kind", "Fee"),
  ]);
  if (paymentResult.error || !paymentResult.data || studentResult.error || !studentResult.data
    || instituteResult.error || !instituteResult.data || balancesResult.error || allocationResult.error) {
    throw new Error("The receipt details or installment schedule could not be loaded.");
  }
  const allocations = allocationResult.data ?? [];
  const paymentIds = [...new Set(allocations.map((item) => item.payment_id))];
  const paymentDates = new Map<string, string>();
  if (paymentIds.length) {
    const { data: paidPayments, error } = await admin.from("payments").select("id, payment_date, status")
      .in("id", paymentIds).eq("institute_id", receipt.institute_id).in("status", ["Paid", "Partially Refunded"]);
    if (error) throw new Error("Installment payment dates could not be loaded.");
    for (const item of paidPayments ?? []) paymentDates.set(item.id, item.payment_date);
  }
  const paidDates = new Map<string, string[]>();
  for (const allocation of allocations) {
    const paymentDate = paymentDates.get(allocation.payment_id);
    if (!paymentDate) continue;
    const dates = paidDates.get(allocation.installment_id) ?? [];
    if (!dates.includes(paymentDate)) dates.push(paymentDate);
    paidDates.set(allocation.installment_id, dates);
  }
  for (const dates of paidDates.values()) dates.sort();
  return {
    receipt: receipt as ReceiptBundle["receipt"],
    payment: {
      amount: asNumber(paymentResult.data.amount), payment_date: paymentResult.data.payment_date,
      method: paymentResult.data.method, status: paymentResult.data.status,
      provider_reference: paymentResult.data.provider_reference, note: paymentResult.data.note,
    },
    student: studentResult.data as ReceiptBundle["student"],
    institute: instituteResult.data as ReceiptBundle["institute"],
    schedule: (balancesResult.data ?? []).map((row) => ({
      installment_id: row.installment_id, sequence_number: row.sequence_number,
      scheduled_amount: asNumber(row.scheduled_amount), due_date: row.due_date,
      paid_amount: asNumber(row.paid_amount), outstanding_amount: asNumber(row.outstanding_amount),
      balance_status: row.balance_status,
    })),
    paidDates,
  };
}

async function loadInstituteLogo(logoPath: string | null) {
  if (!logoPath) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.storage.from("bizbook-institute-logos").download(logoPath);
  if (!data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { kind: "png" as const, bytes };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { kind: "jpg" as const, bytes };
  return null;
}

async function loadCompanyWatermarkLogo(logoUrl: string | null) {
  if (!logoUrl) return null;
  let response: Response;
  try {
    response = await fetch(logoUrl, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new FeeReceiptDeliveryError("The company watermark logo could not be downloaded.", "receipt_logo_unavailable", true);
  }
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 2 * 1024 * 1024) {
    throw new FeeReceiptDeliveryError("The company watermark logo could not be downloaded.", "receipt_logo_unavailable", true);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw new FeeReceiptDeliveryError("The company watermark logo is too large.", "receipt_logo_unavailable", true);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { kind: "png" as const, bytes };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: "jpg" as const, bytes };
  throw new FeeReceiptDeliveryError("The company watermark logo is not a supported image.", "receipt_logo_unavailable", true);
}

function fitPdfText(value: string, font: PDFFont, size: number, width: number) {
  let text = value.replace(/[\r\n]+/g, " ").trim();
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  while (text.length > 1 && font.widthOfTextAtSize(`${text}...`, size) > width) text = text.slice(0, -1);
  return `${text.trimEnd()}...`;
}

function wrapPdfText(value: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r\n?/g, "\n").split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line || !words.length) lines.push(line);
  }
  return lines;
}

export async function createFeeReceiptPdf(receiptId: string): Promise<Uint8Array> {
  const bundle = await loadReceiptBundle(receiptId);
  const template = await loadPlatformFeeReceiptPolicy();
  if (bundle.payment.status !== "Paid" && bundle.payment.status !== "Partially Refunded") {
    throw new Error("Only a paid fee receipt can be downloaded or sent.");
  }
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${bundle.receipt.receipt_number} - Fee receipt`);
  pdf.setAuthor(bundle.institute.business_name);
  pdf.setSubject("Student fee payment receipt");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = colorFromHex(template.accent_color);
  const headerAccent = colorFromHex(template.header_color);
  const ink = rgb(0.12, 0.15, 0.22);
  const muted = rgb(0.39, 0.43, 0.5);
  const line = rgb(0.88, 0.9, 0.93);
  const pale = tintColor(template.accent_color);
  const green = rgb(0.04, 0.42, 0.31);
  const white = rgb(1, 1, 1);
  const logo = template.show_institute_logo
    ? await loadInstituteLogo(bundle.institute.logo_path)
    : null;
  const image = logo?.kind === "png" ? await pdf.embedPng(logo.bytes) : logo?.kind === "jpg" ? await pdf.embedJpg(logo.bytes) : null;
  const watermarkLogo = await loadCompanyWatermarkLogo(template.watermark_logo_url);
  const companyLogo = watermarkLogo?.kind === "png"
    ? await pdf.embedPng(watermarkLogo.bytes)
    : watermarkLogo?.kind === "jpg" ? await pdf.embedJpg(watermarkLogo.bytes) : null;
  const width = 595.28;
  const height = 841.89;
  const page: PDFPage = pdf.addPage([width, height]);
  const margin = 40;
  const contentWidth = width - margin * 2;
  const shortDate = (value: string | null | undefined) => {
    if (!value) return "-";
    const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }).format(date);
  };
  const receiptDate = dateLabel(bundle.payment.payment_date);
  const location = [bundle.institute.address, [bundle.institute.city, bundle.institute.state, bundle.institute.pincode].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const contact = [bundle.institute.phone ? `Phone: ${bundle.institute.phone}` : null, bundle.institute.email ? bundle.institute.email : null].filter(Boolean).join(" · ");
  const nameX = image ? 91 : margin;
  page.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: headerAccent });
  if (image) {
    const fit = image.scale(1);
    const scale = Math.min(38 / fit.width, 38 / fit.height);
    page.drawImage(image, { x: margin, y: height - 54 - fit.height * scale / 2, width: fit.width * scale, height: fit.height * scale });
  }
  page.drawText(fitPdfText(bundle.institute.business_name, bold, 12, template.show_bizbook_brand_mark ? 305 : 390), {
    x: nameX, y: height - 29, size: 10, font: bold, color: white,
  });
  const detailWidth = template.show_bizbook_brand_mark ? 305 : 390;
  page.drawText(fitPdfText(location || "Institute contact details", regular, 6.2, detailWidth), {
    x: nameX, y: height - 42, size: 6, font: regular, color: rgb(0.91, 0.96, 0.93),
  });
  if (contact) page.drawText(fitPdfText(contact, regular, 5.5, detailWidth), {
    x: nameX, y: height - 53, size: 5.5, font: regular, color: rgb(0.91, 0.96, 0.93),
  });
  if (bundle.institute.gstin) page.drawText(fitPdfText(`GSTIN: ${bundle.institute.gstin}`, bold, 5.5, detailWidth), {
    x: nameX, y: height - 63, size: 5.5, font: bold, color: white,
  });
  if (template.show_bizbook_brand_mark) {
    const markX = width - margin - 112;
    const markY = height - 53;
    let brandTextX = markX;
    if (companyLogo) {
      const fit = companyLogo.scale(1);
      const scale = Math.min(25 / fit.width, 25 / fit.height);
      const logoWidth = fit.width * scale;
      const logoHeight = fit.height * scale;
      page.drawImage(companyLogo, { x: markX, y: markY + (25 - logoHeight) / 2, width: logoWidth, height: logoHeight });
      brandTextX = markX + 31;
    }
    page.drawText(fitPdfText(template.bizbook_brand_name, bold, 8, 82), { x: brandTextX, y: markY + 9, size: 8, font: bold, color: white });
  }
  page.drawText(`Receipt ${bundle.receipt.receipt_number}`, {
    x: width - margin - 150, y: height - 63, size: 6, font: regular, color: rgb(0.91, 0.96, 0.93),
  });

  const titleFont = template.title_bold ? bold : regular;
  const titleLines = template.template_title.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2);
  const titleSize = 11;
  const titleLineHeight = 12;
  const titleTop = height - 105;
  const titleBaselines = titleLines.map((_, index) => titleTop - titleSize - index * titleLineHeight);
  const titleTexts = titleLines.map((lineText) => fitPdfText(lineText, titleFont, titleSize, 400));
  let paymentTop: number;
  if (template.title_pill && titleTexts.length) {
    const pillWidth = Math.min(contentWidth, Math.max(...titleTexts.map((lineText) => titleFont.widthOfTextAtSize(lineText, titleSize))) + 24);
    const pillTop = titleBaselines[0] + titleSize + 1;
    const pillBottom = titleBaselines[titleBaselines.length - 1] - 6;
    const pillHeight = pillTop - pillBottom;
    page.drawEllipse({
      x: margin + pillWidth / 2,
      y: pillBottom + pillHeight / 2,
      xScale: pillWidth / 2,
      yScale: pillHeight / 2,
      color: pale,
      borderColor: accent,
      borderWidth: 0.75,
    });
    titleTexts.forEach((lineText, index) => page.drawText(lineText, {
      x: margin + 12,
      y: titleBaselines[index],
      size: titleSize,
      font: titleFont,
      color: accent,
    }));
    paymentTop = pillBottom - 4;
  } else {
    titleTexts.forEach((lineText, index) => page.drawText(lineText, {
      x: margin,
      y: titleBaselines[index],
      size: titleSize,
      font: titleFont,
      color: accent,
    }));
    paymentTop = (titleBaselines[titleBaselines.length - 1] ?? titleTop - titleSize) - 3;
  }
  const hasPaidSeal = template.show_paid_seal && bundle.payment.status === "Paid";
  const sealScale = template.paid_seal_size_percent / 100;
  const paymentHeight = hasPaidSeal ? 70 : 56;
  page.drawRectangle({ x: margin, y: paymentTop - paymentHeight, width: contentWidth, height: paymentHeight, color: pale });
  page.drawText("PAYMENT RECEIVED FROM", { x: margin + 12, y: paymentTop - 15, size: 6.5, font: bold, color: muted });
  page.drawText(fitPdfText(bundle.student.name, bold, 11, 290), { x: margin + 12, y: paymentTop - 31, size: 11, font: bold, color: ink });
  const guardian = bundle.student.parent_name ? `Parent / guardian: ${bundle.student.parent_name}` : "Student fee account";
  page.drawText(fitPdfText(guardian, regular, 7, 290), { x: margin + 12, y: paymentTop - 44, size: 7, font: regular, color: muted });
  const amountLabel = "AMOUNT RECEIVED";
  const amountValue = money(bundle.payment.amount);
  const amountCenterX = width - margin - 80;
  const amountMaxWidth = 160;
  const amountSize = Math.min(15, 15 * amountMaxWidth / bold.widthOfTextAtSize(amountValue, 15));
  const amountWidth = bold.widthOfTextAtSize(amountValue, amountSize);
  const amountX = amountCenterX - amountWidth / 2;
  const labelWidth = bold.widthOfTextAtSize(amountLabel, 6.5);
  const labelY = paymentTop - 12;
  const amountY = paymentTop - 38;
  page.drawText(amountLabel, { x: amountCenterX - labelWidth / 2, y: labelY, size: 6.5, font: bold, color: muted });
  page.drawText(fitPdfText(amountValue, bold, amountSize, amountMaxWidth), { x: amountX, y: amountY, size: amountSize, font: bold, color: accent });
  if (hasPaidSeal) {
    const sealColor = colorFromHex(template.paid_seal_color);
    const sealOpacity = template.paid_seal_opacity_percent / 100;
    const centerX = amountCenterX;
    const radius = 11 * sealScale;
    const centerY = paymentTop - 55;
    page.drawEllipse({ x: centerX, y: centerY, xScale: radius, yScale: radius, borderColor: sealColor, borderOpacity: sealOpacity, borderWidth: 1.4 * sealScale });
    page.drawEllipse({ x: centerX, y: centerY, xScale: 8.5 * sealScale, yScale: 8.5 * sealScale, borderColor: sealColor, borderOpacity: sealOpacity, borderWidth: 0.65 * sealScale });
    const sealFontSize = 4.4 * sealScale;
    const sealTextWidth = bold.widthOfTextAtSize("PAID", sealFontSize);
    page.drawText("PAID", { x: centerX - sealTextWidth / 2, y: centerY - sealFontSize * 0.4, size: sealFontSize, font: bold, color: sealColor, opacity: sealOpacity, rotate: degrees(-12) });
  }

  const metaTop = paymentTop - paymentHeight - 12;
  const meta = [
    ["PAYMENT DATE", receiptDate], ["METHOD", bundle.payment.method],
    ...(template.show_payment_reference ? [["REFERENCE", bundle.payment.provider_reference || "-"] as [string, string]] : []),
  ];
  const metaGap = 8;
  const metaWidth = (contentWidth - metaGap * (meta.length - 1)) / meta.length;
  meta.forEach(([label, value], index) => {
    const x = margin + index * (metaWidth + metaGap);
    page.drawRectangle({ x, y: metaTop - 33, width: metaWidth, height: 33, color: rgb(0.97, 0.98, 0.99), borderColor: line, borderWidth: 0.5 });
    page.drawText(label, { x: x + 8, y: metaTop - 12, size: 6, font: bold, color: muted });
    page.drawText(fitPdfText(value, bold, 7.5, metaWidth - 16), { x: x + 8, y: metaTop - 25, size: 7.5, font: bold, color: ink });
  });

  const scheduledTotal = bundle.schedule.reduce((sum, item) => sum + item.scheduled_amount, 0);
  const paidTotal = bundle.schedule.reduce((sum, item) => sum + item.paid_amount, 0);
  const outstandingTotal = bundle.schedule.reduce((sum, item) => sum + item.outstanding_amount, 0);
  const scheduleTop = metaTop - 53;
  page.drawText("INSTALLMENT ACCOUNT", { x: margin, y: scheduleTop, size: 8, font: bold, color: ink });
  page.drawText(`Total paid ${money(paidTotal)}   ·   Outstanding ${money(outstandingTotal)}`, {
    x: margin, y: scheduleTop - 13, size: 6.5, font: regular, color: muted,
  });
  const tableTop = scheduleTop - 23;
  const footerStart = 105;
  const rowArea = Math.max(0, tableTop - 22 - footerStart - 10);
  const rows = Math.ceil(bundle.schedule.length / 2);
  const rowHeight = rows ? Math.min(19, rowArea / rows) : 18;
  const rowFont = Math.min(6.2, Math.max(3.4, rowHeight * 0.37));
  const colGap = 8;
  const cellWidth = (contentWidth - colGap) / 2;
  page.drawRectangle({ x: margin, y: tableTop - 18, width: contentWidth, height: 18, color: pale });
  page.drawText("INSTALLMENT", { x: margin + 8, y: tableTop - 12, size: 6, font: bold, color: accent });
  page.drawText("AMOUNT · PAID DATE · BALANCE", { x: margin + cellWidth + colGap + 8, y: tableTop - 12, size: 6, font: bold, color: accent });
  page.drawText(`SCHEDULED ${money(scheduledTotal)}`, { x: width - margin - bold.widthOfTextAtSize(`SCHEDULED ${money(scheduledTotal)}`, 6), y: scheduleTop, size: 6, font: bold, color: accent });

  if (template.show_installment_schedule) {
    if (!bundle.schedule.length) {
      page.drawText("No installment schedule is recorded for this student.", { x: margin + 8, y: tableTop - 31, size: 7, font: regular, color: muted });
    }
    bundle.schedule.forEach((item, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = margin + column * (cellWidth + colGap);
      const rowTop = tableTop - 20 - row * rowHeight;
      const bg = row % 2 === 0 ? rgb(0.99, 0.99, 0.995) : white;
      page.drawRectangle({ x, y: rowTop - rowHeight, width: cellWidth, height: rowHeight, color: bg });
      page.drawLine({ start: { x, y: rowTop - rowHeight }, end: { x: x + cellWidth, y: rowTop - rowHeight }, thickness: 0.35, color: line });
      const dates = (bundle.paidDates.get(item.installment_id) ?? []).map(shortDate).join(", ") || "-";
      const installmentLabel = item.sequence_number === 0 ? "Admission fee" : `Installment ${item.sequence_number}`;
      const lineText = `${installmentLabel} | Due ${shortDate(item.due_date)} | Total ${money(item.scheduled_amount)} | Paid ${money(item.paid_amount)} (${dates}) | Left ${money(item.outstanding_amount)}`;
      page.drawText(fitPdfText(lineText, regular, rowFont, cellWidth - 12), {
        x: x + 6, y: rowTop - Math.max(5, rowHeight * 0.64), size: rowFont, font: regular,
        color: item.outstanding_amount > 0 ? muted : green,
      });
    });
  } else {
    page.drawText("Installment details are not included in this receipt.", { x: margin + 8, y: tableTop - 31, size: 7, font: regular, color: muted });
  }

  const terms = template.terms_note.trim();
  const footerLineY = 92;
  page.drawLine({ start: { x: margin, y: footerLineY }, end: { x: width - margin, y: footerLineY }, thickness: 0.6, color: line });
  if (terms) {
    page.drawText("TERMS & CONDITIONS", { x: margin, y: footerLineY - 12, size: 6.5, font: bold, color: ink });
    const termLines = wrapPdfText(terms, regular, 6.2, contentWidth);
    termLines.slice(0, 4).forEach((lineText, index) => {
      page.drawText(lineText, { x: margin, y: footerLineY - 23 - index * 8, size: 6.2, font: regular, color: muted });
    });
  }
  page.drawText(fitPdfText(template.footer_note, regular, 6, contentWidth), { x: margin, y: 32, size: 6, font: regular, color: muted });
  const attribution = template.show_bizbook_brand_mark
    ? `Generated by ${template.bizbook_brand_name}`
    : `Receipt from ${bundle.institute.business_name}`;
  page.drawText(fitPdfText(attribution, regular, 6, contentWidth), { x: margin, y: 20, size: 6, font: regular, color: muted });
  page.drawText(`Paid on ${receiptDate}`, { x: width - margin - bold.widthOfTextAtSize(`Paid on ${receiptDate}`, 6), y: 20, size: 6, font: bold, color: accent });

  if (template.show_watermark && companyLogo) {
    const opacity = template.watermark_opacity_percent / 100;
    const maxLogoWidth = width * template.watermark_size_percent / 100;
    const maxLogoHeight = height * 0.3;
    const fit = companyLogo.scale(1);
    const scale = Math.min(maxLogoWidth / fit.width, maxLogoHeight / fit.height);
    page.drawImage(companyLogo, { x: (width - fit.width * scale) / 2, y: (height - fit.height * scale) / 2, width: fit.width * scale, height: fit.height * scale, opacity });
  }

  return pdf.save();
}

function normalizeWhatsApp(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

async function providerError(response: Response, provider: string): Promise<never> {
  const retryable = response.status === 429 || response.status >= 500;
  throw new FeeReceiptDeliveryError("The receipt provider did not accept the request.", `${provider}_http_${response.status}`, retryable);
}

async function readMessageReference(response: Response, provider: string): Promise<string> {
  let body: unknown;
  try { body = await response.json(); } catch { throw new FeeReceiptDeliveryError("The provider response could not be confirmed.", `${provider}_reference_missing`, false, true); }
  if (!body || typeof body !== "object") throw new FeeReceiptDeliveryError("The provider response could not be confirmed.", `${provider}_reference_missing`, false, true);
  const record = body as { id?: unknown; messages?: Array<{ id?: unknown }> };
  const value = record.messages?.[0]?.id ?? record.id;
  if (typeof value !== "string" || !value.trim()) throw new FeeReceiptDeliveryError("The provider response could not be confirmed.", `${provider}_reference_missing`, false, true);
  return value;
}

async function sendReceiptPdf(channel: ReceiptChannel, bundle: ReceiptBundle, pdfBytes: Uint8Array, idempotencyKey: string) {
  const providerScope = channel === "WhatsApp" ? "whatsapp" : "email";
  const provider = channel === "WhatsApp" ? "whatsapp_cloud" : "resend";
  const admin = createSupabaseAdminClient();
  const { data: connection, error: connectionError } = await admin.from("platform_provider_connections")
    .select("receipt_delivery_enabled, connection_status, last_verified_at")
    .eq("provider_scope", providerScope).eq("provider", provider).eq("environment", "test").maybeSingle();
  if (connectionError) throw new FeeReceiptDeliveryError("Receipt sender settings could not be checked.", "provider_status_unavailable", true);
  if (!connection?.receipt_delivery_enabled || connection.connection_status !== "pending" || !connection.last_verified_at) {
    throw new FeeReceiptDeliveryError("The receipt sender is not enabled yet.", "provider_not_ready", true);
  }
  const { data: rawCredentials, error: credentialsError } = await admin.rpc("get_platform_provider_credentials", {
    p_provider_scope: providerScope,
    p_provider: provider,
    p_allow_pending: true,
  });
  if (credentialsError) throw new FeeReceiptDeliveryError("Receipt sender credentials could not be loaded.", "provider_credentials_unavailable", true);
  const credentials = parseActiveFeeReceiptCredentials(channel, rawCredentials);
  if (!credentials) throw new FeeReceiptDeliveryError("Receipt sender credentials are incomplete.", "provider_credentials_incomplete", true);

  const filename = `${bundle.receipt.receipt_number}.pdf`;
  if (channel === "Email") {
    const destination = bundle.student.parent_email?.trim();
    if (!destination) throw new FeeReceiptDeliveryError("The recipient has no email address.", "recipient_email_missing", false);
    const emailCredentials = credentials as Extract<typeof credentials, { channel: "Email" }>;
    const attachment = Buffer.from(pdfBytes).toString("base64");
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${emailCredentials.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          from: `${emailCredentials.senderName} <${emailCredentials.fromEmail}>`, to: [destination],
          subject: `Fee receipt ${bundle.receipt.receipt_number} - ${bundle.institute.business_name}`,
          text: `Hello ${bundle.student.parent_name || bundle.student.name},\n\nAttached is fee receipt ${bundle.receipt.receipt_number} for ${money(bundle.payment.amount)} paid on ${dateLabel(bundle.payment.payment_date)}.\n\n${bundle.institute.business_name}`,
          attachments: [{ filename, content: attachment }],
        }),
      });
    } catch {
      throw new FeeReceiptDeliveryError("The email request outcome could not be confirmed.", "email_outcome_unknown", false, true);
    }
    if (!response.ok) return providerError(response, "email");
    return { provider: "Resend", messageReference: await readMessageReference(response, "email") };
  }

  const destination = normalizeWhatsApp(bundle.student.whatsapp || bundle.student.parent_mobile);
  if (!destination) throw new FeeReceiptDeliveryError("The recipient has no valid WhatsApp number.", "recipient_whatsapp_missing", false);
  const whatsappCredentials = credentials as Extract<typeof credentials, { channel: "WhatsApp" }>;
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", "application/pdf");
  form.set("file", new Blob([Buffer.from(pdfBytes)], { type: "application/pdf" }), filename);
  let upload: Response;
  try {
    upload = await fetch(`https://graph.facebook.com/${whatsappCredentials.apiVersion}/${encodeURIComponent(whatsappCredentials.phoneNumberId)}/media`, {
      method: "POST", headers: { Authorization: `Bearer ${whatsappCredentials.accessToken}` },
      body: form, signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new FeeReceiptDeliveryError("The WhatsApp PDF upload could not be confirmed.", "whatsapp_upload_outcome_unknown", true);
  }
  if (!upload.ok) return providerError(upload, "whatsapp_upload");
  let media: { id?: unknown };
  try { media = await upload.json() as { id?: unknown }; } catch { throw new FeeReceiptDeliveryError("WhatsApp did not return a PDF reference.", "whatsapp_upload_reference_missing", true); }
  if (typeof media.id !== "string" || !media.id) throw new FeeReceiptDeliveryError("WhatsApp did not return a PDF reference.", "whatsapp_upload_reference_missing", true);

  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${whatsappCredentials.apiVersion}/${encodeURIComponent(whatsappCredentials.phoneNumberId)}/messages`, {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${whatsappCredentials.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: destination, type: "template",
        template: {
          name: whatsappCredentials.templateName,
          language: { code: whatsappCredentials.templateLanguage },
          components: [
            { type: "header", parameters: [{ type: "document", document: { id: media.id, filename } }] },
            { type: "body", parameters: [
              { type: "text", text: bundle.student.name },
              { type: "text", text: bundle.receipt.receipt_number },
              { type: "text", text: bundle.institute.business_name },
              { type: "text", text: money(bundle.payment.amount) },
              { type: "text", text: dateLabel(bundle.payment.payment_date) },
            ] },
          ],
        },
      }),
    });
  } catch {
    throw new FeeReceiptDeliveryError("The WhatsApp receipt send outcome could not be confirmed.", "whatsapp_outcome_unknown", false, true);
  }
  if (!response.ok) return providerError(response, "whatsapp");
  return { provider: "Meta WhatsApp Cloud API", messageReference: await readMessageReference(response, "whatsapp") };
}

async function setDeliveryStatus(id: string, values: Record<string, unknown>) {
  const admin = createSupabaseAdminClient();
  await admin.from("fee_receipt_deliveries").update(values as TablesUpdate<"fee_receipt_deliveries">).eq("id", id);
}

async function ensureDelivery(receiptId: string, channel: ReceiptChannel) {
  const admin = createSupabaseAdminClient();
  await admin.from("fee_receipt_deliveries").upsert({ receipt_id: receiptId, channel }, {
    onConflict: "receipt_id,channel", ignoreDuplicates: true,
  });
  const { data } = await admin.from("fee_receipt_deliveries").select("*")
    .eq("receipt_id", receiptId).eq("channel", channel).maybeSingle();
  return data;
}

async function dispatchOne(receiptId: string, channel: ReceiptChannel) {
  const admin = createSupabaseAdminClient();
  let delivery = await ensureDelivery(receiptId, channel);
  if (!delivery) return { channel, status: "Queued" as const };
  if (delivery.delivery_status === "Sent" || delivery.delivery_status === "Unknown" || delivery.delivery_status === "Processing") {
    return { channel, status: delivery.delivery_status };
  }
  const bundle = await loadReceiptBundle(receiptId);
  if (bundle.payment.status !== "Paid" && bundle.payment.status !== "Partially Refunded") {
    await setDeliveryStatus(delivery.id, { delivery_status: "Skipped", retryable: false, last_error_code: "payment_not_paid" });
    return { channel, status: "Skipped" as const };
  }
  const consent = channel === "WhatsApp" ? bundle.student.whatsapp_receipt_opt_in : bundle.student.email_receipt_opt_in;
  if (!consent) {
    await setDeliveryStatus(delivery.id, { delivery_status: "Skipped", retryable: false, last_error_code: "receipt_consent_missing" });
    return { channel, status: "Skipped" as const };
  }
  const destination = channel === "WhatsApp"
    ? normalizeWhatsApp(bundle.student.whatsapp || bundle.student.parent_mobile)
    : bundle.student.parent_email?.trim() || null;
  if (!destination) {
    await setDeliveryStatus(delivery.id, { delivery_status: "Skipped", retryable: false, last_error_code: channel === "WhatsApp" ? "recipient_whatsapp_missing" : "recipient_email_missing" });
    return { channel, status: "Skipped" as const };
  }
  if (delivery.delivery_status === "Skipped" && delivery.last_error_code !== "payment_not_paid") {
    const { data: reset } = await admin.from("fee_receipt_deliveries").update({
      delivery_status: "Queued", retryable: true, last_error_code: null,
    }).eq("id", delivery.id).eq("delivery_status", "Skipped").select("*").maybeSingle();
    if (reset) delivery = reset;
  }
  const fingerprint = createHash("sha256").update(destination.toLowerCase()).digest("hex");
  if (delivery.delivery_status === "Failed" && (!delivery.retryable || (delivery.next_attempt_at && Date.parse(delivery.next_attempt_at) > Date.now()))) {
    return { channel, status: delivery.delivery_status };
  }
  const nextAttemptCount = Number(delivery.attempt_count) + 1;
  const { data: claimed, error: claimError } = await admin.from("fee_receipt_deliveries").update({
    delivery_status: "Processing", attempt_count: nextAttemptCount, attempted_at: new Date().toISOString(),
    recipient_fingerprint: fingerprint, last_error_code: null, next_attempt_at: null,
  }).eq("id", delivery.id).in("delivery_status", ["Queued", "Failed", "Skipped"]).eq("retryable", true).select("id, idempotency_key").maybeSingle();
  if (claimError || !claimed) return { channel, status: "Processing" as const };
  try {
    const pdf = await createFeeReceiptPdf(receiptId);
    const result = await sendReceiptPdf(channel, bundle, pdf, claimed.idempotency_key);
    await setDeliveryStatus(delivery.id, {
      delivery_status: "Sent", provider: result.provider, provider_message_reference: result.messageReference,
      sent_at: new Date().toISOString(), retryable: false, last_error_code: null,
    });
    return { channel, status: "Sent" as const };
  } catch (error) {
    const failure = error instanceof FeeReceiptDeliveryError
      ? error
      : new FeeReceiptDeliveryError("Receipt delivery failed.", "receipt_delivery_failed", true);
    if (["provider_not_ready", "provider_credentials_unavailable", "provider_credentials_incomplete"].includes(failure.safeCode)) {
      await setDeliveryStatus(delivery.id, { delivery_status: "Queued", retryable: true, next_attempt_at: null, last_error_code: failure.safeCode });
      return { channel, status: "Queued" as const };
    }
    const unknown = failure.unknownOutcome;
    const retryable = failure.retryable && !unknown;
    const backoffMinutes = Math.min(24 * 60, 2 ** Math.min(nextAttemptCount, 10));
    await setDeliveryStatus(delivery.id, {
      delivery_status: unknown ? "Unknown" : "Failed", retryable,
      next_attempt_at: retryable ? new Date(Date.now() + backoffMinutes * 60_000).toISOString() : null,
      last_error_code: failure.safeCode,
    });
    return { channel, status: unknown ? "Unknown" as const : "Failed" as const };
  }
}

export async function dispatchFeeReceipt(receiptId: string) {
  const policy = await loadPlatformFeeReceiptPolicy();
  const chosen = policy.delivery_channels;
  const result: Array<{ channel: ReceiptChannel; status: string }> = [];
  for (const channel of chosen) result.push(await dispatchOne(receiptId, channel));
  return result;
}

export async function dispatchFeeReceiptForPayment(paymentId: string) {
  const admin = createSupabaseAdminClient();
  const { data: receipt } = await admin.from("fee_receipts").select("id").eq("payment_id", paymentId).maybeSingle();
  if (!receipt) return [];
  return dispatchFeeReceipt(receipt.id);
}
