"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { BellRing, LoaderCircle, Megaphone, PencilLine, Plus, RefreshCw, Send } from "lucide-react";

type Announcement = {
  id: string;
  title: string;
  body: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:bg-slate-50";

function displayDate(value: string | null) {
  if (!value) return "Not published";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function PlatformAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState("");
  const [publishNow, setPublishNow] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/platform-admin/announcements", { cache: "no-store" });
      const result = await response.json() as { announcements?: Announcement[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Updates could not be loaded.");
      setAnnouncements(Array.isArray(result.announcements) ? result.announcements : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Updates could not be loaded.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function startNew() {
    setEditingId(""); setTitle(""); setMessage(""); setPublishNow(true); setError(""); setNotice("");
  }

  function edit(item: Announcement) {
    setEditingId(item.id); setTitle(item.title); setMessage(item.body); setPublishNow(item.is_published); setError(""); setNotice("");
    document.getElementById("platform-announcement-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform-admin/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId || null, title, message, isPublished: publishNow }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The update could not be saved.");
      startNew();
      setNotice(publishNow ? "Update published to workspace notifications." : "Update saved as a draft.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The update could not be saved.");
    } finally { setBusy(false); }
  }

  async function setPublished(item: Announcement, isPublished: boolean) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform-admin/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, title: item.title, message: item.body, isPublished }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The update status could not be changed.");
      setNotice(isPublished ? "Update published to all institute workspaces." : "Update removed from workspace notifications.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The update status could not be changed.");
    } finally { setBusy(false); }
  }

  return (
    <section id="platform-announcements" className="scroll-mt-28 rounded-3xl border border-yellow-200 bg-gradient-to-br from-yellow-50 via-white to-lime-50/70 p-5 shadow-sm sm:p-6" aria-labelledby="platform-announcements-title">
      <header className="flex items-start gap-3 rounded-2xl border border-yellow-200 bg-yellow-50/90 p-4 sm:p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-yellow-200 bg-white text-yellow-800"><BellRing size={18} /></span>
        <div className="min-w-0"><h2 id="platform-announcements-title" className="text-lg font-bold tracking-tight text-slate-950">Workspace announcements</h2><p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">Publish service news and subscription updates. Published messages appear in the notification bell for signed-in institute members.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading || busy} aria-label="Refresh announcements" className="ml-auto grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
      </header>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form id="platform-announcement-form" onSubmit={save} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-slate-900">{editingId ? "Edit update" : "Create an update"}</h3>{editingId && <button type="button" onClick={startNew} className="inline-flex items-center gap-1 text-xs font-bold text-violet-800"><Plus size={13} />New update</button>}</div>
          <label className="block text-xs font-semibold text-slate-700">Title<input className={`${inputClass} mt-1`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required disabled={busy} placeholder="Scheduled maintenance" /></label>
          <label className="block text-xs font-semibold text-slate-700">Message<textarea className={`${inputClass} mt-1 min-h-32 resize-y`} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} required disabled={busy} placeholder="Write a clear update for institute owners and staff." /></label>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-700"><input className="mt-0.5 accent-violet-700" type="checkbox" checked={publishNow} onChange={(event) => setPublishNow(event.target.checked)} disabled={busy} /><span><strong>{publishNow ? "Publish now" : "Keep as draft"}</strong><br />{publishNow ? "The notification will appear immediately in every institute workspace." : "Only company administrators can see the draft."}</span></label>
          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
          {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
          <button type="submit" disabled={busy} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-violet-800 disabled:opacity-50">{busy ? <LoaderCircle size={15} className="animate-spin" /> : publishNow ? <Send size={15} /> : <PencilLine size={15} />}{editingId ? "Save update" : publishNow ? "Publish update" : "Save draft"}</button>
        </form>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-slate-900">Recent updates</h3><span className="text-xs text-slate-500">{announcements.length} of 50</span></div>
          {loading && announcements.length === 0 ? <p role="status" className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Loading company updates…</p>
            : announcements.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center"><Megaphone className="mx-auto text-slate-400" size={22} /><p className="mt-2 text-sm font-semibold text-slate-700">No updates published</p><p className="mt-1 text-xs text-slate-500">New service notes will appear here and in member workspace notifications.</p></div>
              : announcements.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="font-bold text-slate-900">{item.title}</h4><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${item.is_published ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{item.is_published ? "Published" : "Draft"}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{item.body}</p><p className="mt-2 text-[11px] text-slate-400">{item.is_published ? "Published" : "Updated"} · {displayDate(item.published_at ?? item.updated_at)}</p></div><button type="button" onClick={() => edit(item)} disabled={busy} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><PencilLine size={13} />Edit</button></div><button type="button" onClick={() => void setPublished(item, !item.is_published)} disabled={busy} className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50 ${item.is_published ? "border border-amber-200 bg-amber-50 text-amber-900" : "bg-violet-700 text-white hover:bg-violet-800"}`}>{item.is_published ? "Unpublish" : "Publish"}</button></article>)}
        </div>
      </div>
    </section>
  );
}
