"use client";

import { useEffect, useState } from "react";
import { BellRing, Clock3, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";

type Channel = "Email" | "WhatsApp" | "Both";
type Stage = { reminder_number: number; day_offset: number; channel: Channel; send_time: string };
type PolicyResponse = { policy?: { is_enabled: boolean; schedule: unknown; updated_at: string }; canEdit?: boolean; error?: string };
type Props = {
  endpoint?: string;
  sectionId?: string;
  title?: string;
  description?: string;
  dateReference?: string;
  audience?: string;
  tone?: "amber" | "indigo";
};

const inputClass = "mt-1.5 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:bg-slate-50 disabled:text-slate-400";

function parseStages(value: unknown): Stage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null;
  const stages: Stage[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (row.reminder_number !== index + 1
      || typeof row.day_offset !== "number" || !Number.isInteger(row.day_offset) || row.day_offset < -30 || row.day_offset > 30
      || (row.channel !== "Email" && row.channel !== "WhatsApp" && row.channel !== "Both")
      || typeof row.send_time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.send_time)) return null;
    stages.push({ reminder_number: index + 1, day_offset: row.day_offset, channel: row.channel, send_time: row.send_time });
  }
  return stages;
}

export default function PlatformReminderSettings({
  endpoint = "/api/platform-admin/reminders",
  sectionId = "student-reminder-schedule",
  title = "Student fee reminder schedule",
  description = "Company-wide schedule for fee reminders that BizBook sends to opted-in students and families. Coaching institutes cannot change these settings.",
  dateReference = "fee due date",
  audience = "Student and family contacts",
  tone = "amber",
}: Props = {}) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const emailCount = stages.filter((stage) => stage.channel === "Email" || stage.channel === "Both").length;
  const whatsAppCount = stages.filter((stage) => stage.channel === "WhatsApp" || stage.channel === "Both").length;
  const messageCount = emailCount + whatsAppCount;
  const theme = tone === "indigo"
    ? { section: "border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-blue-50", header: "border-indigo-100", icon: "bg-indigo-100 text-indigo-800", eyebrow: "text-indigo-800", panel: "border-indigo-100", add: "border-indigo-200 text-indigo-900 hover:bg-indigo-50", save: "bg-indigo-700 hover:bg-indigo-800" }
    : { section: "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50", header: "border-amber-100", icon: "bg-amber-100 text-amber-800", eyebrow: "text-amber-800", panel: "border-amber-100", add: "border-amber-200 text-amber-900 hover:bg-amber-50", save: "bg-amber-700 hover:bg-amber-800" };

  useEffect(() => {
    let active = true;
    void fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as PolicyResponse;
        if (!response.ok || !result.policy) throw new Error(result.error || "Reminder settings could not be loaded.");
        const parsed = parseStages(result.policy.schedule);
        if (!parsed) throw new Error("The saved reminder schedule is invalid. Save a valid schedule to continue.");
        if (!active) return;
        setStages(parsed);
        setEnabled(result.policy.is_enabled);
        setCanEdit(result.canEdit === true);
        setUpdatedAt(result.policy.updated_at);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Reminder settings could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint]);

  function updateStage(index: number, patch: Partial<Stage>) {
    setStages((current) => current.map((stage, stageIndex) => stageIndex === index ? { ...stage, ...patch } : stage));
    setNotice("");
  }

  function addStage() {
    if (stages.length >= 5) return;
    const previous = stages[stages.length - 1];
    let nextOffset = previous ? previous.day_offset + 1 : 0;
    if (nextOffset > 30) nextOffset = -30;
    setStages((current) => [...current, {
      reminder_number: current.length + 1,
      day_offset: nextOffset,
      channel: previous?.channel ?? "WhatsApp",
      send_time: previous?.send_time ?? "09:00",
    }]);
    setNotice("");
  }

  function removeStage(index: number) {
    setStages((current) => current.filter((_, itemIndex) => itemIndex !== index).map((stage, itemIndex) => ({ ...stage, reminder_number: itemIndex + 1 })));
    setNotice("");
  }

  async function savePolicy() {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: enabled, schedule: stages }),
      });
      const result = await response.json() as PolicyResponse;
      if (!response.ok) throw new Error(result.error || "Reminder settings could not be saved.");
      const parsed = parseStages(result.policy?.schedule);
      if (!parsed) throw new Error("The saved schedule could not be confirmed. Refresh and check the settings.");
      setStages(parsed);
      setUpdatedAt(result.policy?.updated_at ?? new Date().toISOString());
      setNotice("Reminder schedule saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reminder settings could not be saved.");
    } finally { setSaving(false); }
  }

  return (
    <section id={sectionId} className={`scroll-mt-28 overflow-hidden rounded-3xl border bg-gradient-to-br shadow-sm ${theme.section}`}>
      <header className={`flex flex-col gap-4 border-b bg-white/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${theme.header}`}>
        <div className="flex items-start gap-3"><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${theme.icon}`}><BellRing size={19} /></span><div><p className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${theme.eyebrow}`}>Communications · Company controlled · {audience}</p><h2 className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">{title}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">{description}</p></div></div>
        <label className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-bold ${enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}>
          <input type="checkbox" checked={enabled} disabled={!canEdit || loading} onChange={(event) => { setEnabled(event.target.checked); setNotice(""); }} className="size-4 accent-emerald-700" />
          {enabled ? "Reminders enabled" : "Reminders paused"}
        </label>
      </header>

      <div className="space-y-4 p-4 sm:p-6">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</p>}
        {!loading && !error && <div className="grid gap-2 sm:grid-cols-3" aria-label="Reminder totals by channel">
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Email</p><p className="mt-0.5 text-sm font-extrabold text-sky-950">{emailCount} reminders</p></div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">WhatsApp</p><p className="mt-0.5 text-sm font-extrabold text-emerald-950">{whatsAppCount} reminders</p></div>
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wide text-violet-700">Total messages</p><p className="mt-0.5 text-sm font-extrabold text-violet-950">{messageCount} messages · {stages.length} stages</p></div>
        </div>}

        <div className={`flex flex-col gap-3 rounded-2xl border bg-white/80 p-4 sm:flex-row sm:items-center sm:justify-between ${theme.panel}`}>
          <p className="text-xs leading-5 text-slate-600">Each stage can use Email, WhatsApp, or both. Add more than one stage on the same date if you need different channels or send times. Times follow the recipient’s local time zone.</p>
          {updatedAt && <span className="shrink-0 text-[10px] text-slate-500">Updated {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(updatedAt))}</span>}
        </div>

        {loading ? <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white p-8 text-sm font-semibold text-slate-500"><LoaderCircle size={17} className="animate-spin" />Loading reminder settings…</div> : <div className="space-y-3">
          {stages.map((stage, index) => <article key={stage.reminder_number} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_28px_-22px_rgba(15,23,42,.28)]">
            <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-violet-50 text-[11px] font-extrabold text-violet-800">{stage.reminder_number}</span><h3 className="text-sm font-bold text-slate-900">Reminder {stage.reminder_number}</h3></div>{canEdit && <button type="button" onClick={() => removeStage(index)} disabled={stages.length <= 1} aria-label={`Remove reminder ${stage.reminder_number}`} className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={15} /></button>}</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-[11px] font-bold text-slate-600">Days from {dateReference}<span className="mt-1 block font-normal text-slate-400">Negative = before · 0 = date · positive = after</span><input className={inputClass} type="number" min={-30} max={30} step={1} value={stage.day_offset} disabled={!canEdit} onChange={(event) => updateStage(index, { day_offset: Number(event.target.value) })} /></label>
              <label className="text-[11px] font-bold text-slate-600">Send by<select className={inputClass} value={stage.channel} disabled={!canEdit} onChange={(event) => updateStage(index, { channel: event.target.value as Channel })}><option value="WhatsApp">WhatsApp</option><option value="Email">Email</option><option value="Both">WhatsApp + Email</option></select></label>
              <label className="text-[11px] font-bold text-slate-600">Send time · local<span className="mt-1 block font-normal text-slate-400">Institute time zone</span><span className="relative block"><Clock3 size={15} className="pointer-events-none absolute left-3 top-[13px] text-amber-700" /><input className={`${inputClass} pl-9`} type="time" value={stage.send_time} disabled={!canEdit} onChange={(event) => updateStage(index, { send_time: event.target.value })} /></span></label>
            </div>
          </article>)}
          {stages.length === 0 && <p className="rounded-xl border border-dashed border-rose-200 bg-white p-5 text-sm text-rose-800">No valid reminder schedule was loaded. Restore a valid schedule before saving.</p>}
        </div>}

        {!loading && <div className={`flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between ${theme.header}`}>
          <div className="flex gap-2">{canEdit && <button type="button" onClick={addStage} disabled={stages.length >= 5} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border bg-white px-3.5 text-xs font-bold transition disabled:opacity-45 ${theme.add}`}><Plus size={15} />Add reminder <span>{stages.length}/5</span></button>}</div>
          {canEdit ? <button type="button" onClick={() => void savePolicy()} disabled={saving || loading || stages.length < 1} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-extrabold text-white shadow-sm transition disabled:opacity-50 ${theme.save}`}>{saving ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}{saving ? "Saving schedule…" : "Save reminder schedule"}</button> : <span className="text-xs font-semibold text-slate-500">Read-only: Company Admin support roles cannot change delivery schedules.</span>}
        </div>}
      </div>
    </section>
  );
}
