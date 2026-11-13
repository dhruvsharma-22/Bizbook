type PreviewPolicy = {
  template_title: string;
  accent_color: string;
  header_color: string;
  footer_note: string;
  terms_note: string;
  show_installment_schedule?: boolean;
  show_payment_reference: boolean;
  show_institute_logo: boolean;
  show_bizbook_brand_mark: boolean;
  bizbook_brand_name: string;
  show_watermark?: boolean;
  watermark_size_percent?: number;
  watermark_opacity_percent?: number;
  watermark_logo_url?: string | null;
  title_bold?: boolean;
  title_pill?: boolean;
  show_paid_seal?: boolean;
  paid_seal_color?: string;
  paid_seal_opacity_percent?: number;
  paid_seal_size_percent?: number;
};

type PreviewScheduleItem = {
  installment_id: string;
  sequence_number: number;
  scheduled_amount: number;
  due_date: string | null;
  paid_amount: number;
  outstanding_amount: number;
  paid_dates: string[];
};

type Props = {
  policy: PreviewPolicy;
  institute: {
    business_name: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    phone?: string | null;
    email?: string | null;
    gstin?: string | null;
    logo_url?: string | null;
  };
  receipt?: {
    receipt_number: string;
    amount: number;
    payment_date: string;
    method: string;
    reference?: string | null;
    status: string;
    student_name: string;
    parent_name?: string | null;
    schedule: PreviewScheduleItem[];
  };
  sample?: boolean;
};

const money = (amount: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(Number.isFinite(amount) ? amount : 0);

const shortDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "2-digit" }).format(date);
};

export default function StudentFeeReceiptPreview({ policy, institute, receipt, sample = false }: Props) {
  const schedule = receipt?.schedule ?? [
    { installment_id: "sample-1", sequence_number: 1, scheduled_amount: 5000, due_date: "2026-10-30", paid_amount: 5000, outstanding_amount: 0, paid_dates: ["2026-10-27"] },
    { installment_id: "sample-2", sequence_number: 2, scheduled_amount: 2500, due_date: "2026-11-30", paid_amount: 0, outstanding_amount: 2500, paid_dates: [] },
  ];
  const amount = receipt?.amount ?? 5000;
  const paidTotal = schedule.reduce((total, item) => total + item.paid_amount, 0);
  const outstandingTotal = schedule.reduce((total, item) => total + item.outstanding_amount, 0);
  const address = [institute.address, [institute.city, institute.state, institute.pincode].filter(Boolean).join(", ")]
    .filter(Boolean).join(" · ");
  const contact = [institute.phone, institute.email].filter(Boolean).join(" · ");
  const sealSize = policy.paid_seal_size_percent ?? 100;
  const accent = policy.accent_color || "#166534";
  const headerColor = policy.header_color || accent;

  return (
    <article className="relative isolate mx-auto aspect-[210/297] w-full max-w-[390px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_-22px_rgba(15,23,42,.5)]">
      <header className="relative z-30 flex min-h-[52px] items-center justify-between gap-2 px-[5%] py-2 text-white" style={{ backgroundColor: headerColor }}>
        <div className="flex min-w-0 items-center gap-2">
          {policy.show_institute_logo && (institute.logo_url
            ? <img src={institute.logo_url} alt={`${institute.business_name} logo`} className="size-7 shrink-0 rounded-md border border-white/30 bg-white object-contain p-0.5" />
            : <span className="grid size-7 shrink-0 place-items-center rounded-md border border-white/35 bg-white/10 text-[6px] font-bold">LOGO</span>)}
          <span className="min-w-0"><strong className="block truncate text-[10px] leading-tight">{institute.business_name || "Institute name"}</strong><span className="mt-0.5 block truncate text-[6px] leading-tight text-white/85">{address || "Institute contact details"}</span>{(contact || institute.gstin) && <span className="mt-0.5 block truncate text-[6px] leading-tight text-white/75">{[contact, institute.gstin ? `GSTIN ${institute.gstin}` : ""].filter(Boolean).join(" · ")}</span>}</span>
        </div>
        {policy.show_bizbook_brand_mark && <span className="flex shrink-0 items-center gap-1.5">{policy.watermark_logo_url ? <img src={policy.watermark_logo_url} alt="" className="size-6 shrink-0 object-contain" /> : <span className="text-[8px] font-extrabold">BB</span>}<span className="max-w-[72px] truncate text-[8px] font-extrabold">{policy.bizbook_brand_name}</span></span>}
      </header>

      <div className="relative z-10 space-y-[2.5%] px-[5%] py-[3%] text-slate-900">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0"><p className={`whitespace-pre-line text-[8px] ${policy.title_bold === false ? "font-medium" : "font-extrabold"} ${policy.title_pill ? "inline-block rounded-full border px-2 py-0.5" : ""}`} style={{ color: accent, borderColor: policy.title_pill ? `${accent}55` : undefined, backgroundColor: policy.title_pill ? `${accent}10` : undefined }}>{policy.template_title || "Fee Payment Receipt"}</p><p className="mt-0.5 truncate text-[6px] text-slate-500">Receipt {receipt?.receipt_number ?? "BBR-SAMPLE-0001"}</p></div>
          {sample && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[6px] font-bold text-emerald-800">SAMPLE</span>}
        </div>

        <section className="flex items-center justify-between gap-2 rounded-lg p-[3%]" style={{ backgroundColor: `${accent}10` }}>
          <div className="min-w-0"><p className="text-[6px] font-bold uppercase text-slate-500">Payment received from</p><p className="mt-0.5 truncate text-[9px] font-extrabold">{receipt?.student_name ?? "Student name"}</p><p className="truncate text-[6px] text-slate-500">{receipt?.parent_name ? `Parent / guardian: ${receipt.parent_name}` : "Parent / guardian"}</p></div>
          <div className="flex min-w-[98px] shrink-0 flex-col items-center rounded-md border px-2 py-1 text-center" style={{ borderColor: `${accent}35`, backgroundColor: `${accent}10` }}><p className="text-[6px] font-bold uppercase text-slate-500">Amount received</p><p className="mt-0.5 whitespace-nowrap text-[12px] font-black" style={{ color: accent }}>{money(amount)}</p>{(sample || receipt?.status === "Paid") && policy.show_paid_seal !== false && <span className="mt-1 inline-grid rotate-[-12deg] place-items-center rounded-full border-2 font-black" style={{ width: `${22 * sealSize / 100}px`, height: `${22 * sealSize / 100}px`, fontSize: `${4.5 * sealSize / 100}px`, color: policy.paid_seal_color ?? "#B91C1C", borderColor: policy.paid_seal_color ?? "#B91C1C", outline: `${sealSize / 100}px solid ${policy.paid_seal_color ?? "#B91C1C"}`, outlineOffset: `${-4 * sealSize / 100}px`, opacity: (policy.paid_seal_opacity_percent ?? 70) / 100 }}>PAID</span>}</div>
        </section>

        <div className={`grid gap-1 ${policy.show_payment_reference ? "grid-cols-4" : "grid-cols-3"}`}>
          {[["PAYMENT DATE", shortDate(receipt?.payment_date ?? "2026-10-27")], ["METHOD", receipt?.method ?? "Online / Manual"], ["TYPE", "Fee payment"], ...(policy.show_payment_reference ? [["REFERENCE", receipt?.reference || "TXN-123456"]] : [])].map(([label, value]) => <div key={label} className="min-w-0 rounded border border-slate-100 bg-slate-50 p-1.5"><p className="truncate text-[5px] font-bold uppercase text-slate-500">{label}</p><p className="mt-0.5 truncate text-[6px] font-bold text-slate-800" title={value}>{value}</p></div>)}
        </div>

        {policy.show_installment_schedule !== false && <section>
          <div className="mb-1 flex items-center justify-between gap-2"><div><p className="text-[7px] font-extrabold">Installments</p><p className="text-[5px] text-slate-500">Paid {money(paidTotal)} · Balance {money(outstandingTotal)}</p></div></div>
          <div className="overflow-hidden rounded border border-slate-200 bg-white/50">
            <table className="w-full table-fixed border-collapse text-left text-[5px] leading-tight tabular-nums">
              <colgroup><col className="w-[24%]" /><col className="w-[14%]" /><col className="w-[15%]" /><col className="w-[14%]" /><col className="w-[17%]" /><col className="w-[16%]" /></colgroup>
              <thead style={{ backgroundColor: `${accent}12`, color: accent }}><tr className="border-b border-slate-200 text-[5px] font-bold uppercase tracking-[0.02em]"><th className="px-1 py-1">Item</th><th className="px-1 py-1">Due</th><th className="px-1 py-1 text-right">Amount</th><th className="px-1 py-1 text-right">Paid</th><th className="px-1 py-1">Paid on</th><th className="px-1 py-1 text-right">Balance</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{schedule.map((item, index) => <tr key={item.installment_id} className={index % 2 ? "bg-slate-50/50" : "bg-white/50"}><td className="break-words px-1 py-1 font-semibold text-slate-800">{item.sequence_number === 0 ? "Admission fee" : `Installment ${item.sequence_number}`}</td><td className="whitespace-nowrap px-1 py-1 text-slate-600">{shortDate(item.due_date)}</td><td className="whitespace-nowrap px-1 py-1 text-right text-slate-700">{money(item.scheduled_amount)}</td><td className="whitespace-nowrap px-1 py-1 text-right font-semibold text-emerald-800">{money(item.paid_amount)}</td><td className="break-words px-1 py-1 text-slate-600">{item.paid_dates.length ? item.paid_dates.map(shortDate).join(" · ") : "—"}</td><td className={`whitespace-nowrap px-1 py-1 text-right font-bold ${item.outstanding_amount > 0 ? "text-rose-700" : "text-emerald-800"}`}>{money(item.outstanding_amount)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>}

        <div className="rounded border border-slate-200 p-[2.5%]"><p className="text-[6px] font-extrabold">Terms and conditions</p><p className="mt-0.5 line-clamp-3 whitespace-pre-line text-[5px] leading-[1.4] text-slate-600">{policy.terms_note}</p></div>
        <footer className="border-t border-slate-200 pt-[2%]"><p className="line-clamp-2 text-[5px] leading-[1.4] text-slate-500">{policy.footer_note}</p>{policy.show_bizbook_brand_mark && <p className="mt-0.5 text-[5px] font-semibold text-slate-700">Issued by {policy.bizbook_brand_name}</p>}</footer>
      </div>
      {policy.show_watermark && policy.watermark_logo_url && <img aria-hidden="true" src={policy.watermark_logo_url} alt="" className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-auto -translate-x-1/2 -translate-y-1/2 object-contain" style={{ width: `${policy.watermark_size_percent ?? 42}%`, maxHeight: "36%", opacity: (policy.watermark_opacity_percent ?? 8) / 100 }} />}
    </article>
  );
}
