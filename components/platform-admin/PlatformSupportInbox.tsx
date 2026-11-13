"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LifeBuoy, LoaderCircle, MessageSquareText, RefreshCw, Send } from "lucide-react";
import { SUPPORT_PRIORITIES, SUPPORT_STATUSES, type SupportPriority, type SupportStatus } from "@/lib/supabase/support-validation";

type Message = { id: string; author_user_id: string; author_kind: "institute" | "platform"; body: string; created_at: string };
type Ticket = {
  id: string; institute_id: string; business_name: string; created_by: string; category: string; subject: string;
  status: SupportStatus; priority: SupportPriority; created_at: string; updated_at: string;
  resolved_at: string | null; closed_at: string | null; messages: Message[];
};
type TicketPage = { total: number; tickets: Ticket[] };

const pageSize = 20;
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:bg-slate-50";

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function isTicketPage(value: unknown): value is TicketPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Partial<TicketPage>;
  return Number.isInteger(page.total) && Array.isArray(page.tickets)
    && page.tickets.every((ticket) => ticket && typeof ticket.id === "string" && Array.isArray(ticket.messages));
}

function keyForReply() { return globalThis.crypto.randomUUID(); }

export default function PlatformSupportInbox() {
  const [filter, setFilter] = useState<"all" | SupportStatus>("all");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<TicketPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [stateDrafts, setStateDrafts] = useState<Record<string, { status: SupportStatus; priority: SupportPriority }>>({});
  const replyKeys = useRef<Record<string, { signature: string; key: string }>>({});
  const requestId = useRef(0);

  const refresh = useCallback(async (status: typeof filter, nextOffset: number) => {
    const currentRequest = ++requestId.current;
    setLoading(true); setError("");
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(nextOffset) });
    if (status !== "all") params.set("status", status);
    try {
      const response = await fetch(`/api/platform-admin/support?${params.toString()}`, { cache: "no-store" });
      const result = await response.json() as { result?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error || "Support queue could not be loaded.");
      if (!isTicketPage(result.result)) throw new Error("The support response was incomplete.");
      if (currentRequest === requestId.current) setPage(result.result);
      return true;
    } catch (cause) {
      if (currentRequest === requestId.current) setError(cause instanceof Error ? cause.message : "Support queue could not be loaded.");
      return false;
    } finally { if (currentRequest === requestId.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(filter, offset); }, 0);
    return () => window.clearTimeout(timer);
  }, [filter, offset, refresh]);

  async function mutate(ticketId: string, body: Record<string, unknown>, successMessage: string) {
    setBusy(ticketId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform-admin/support", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The support update was rejected.");
      const refreshed = await refresh(filter, offset);
      setNotice(refreshed ? successMessage : `${successMessage} The queue could not refresh; retry to confirm the latest status.`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The support update could not be completed.");
      return false;
    } finally { setBusy(""); }
  }

  function currentDraft(ticket: Ticket) {
    return stateDrafts[ticket.id] ?? { status: ticket.status, priority: ticket.priority };
  }

  async function reply(ticket: Ticket) {
    const message = (replyDrafts[ticket.id] ?? "").trim();
    if (!message || busy) return;
    const signature = JSON.stringify([ticket.id, message]);
    if (replyKeys.current[ticket.id]?.signature !== signature) replyKeys.current[ticket.id] = { signature, key: keyForReply() };
    const key = replyKeys.current[ticket.id].key;
    const saved = await mutate(ticket.id, { action: "reply", ticketId: ticket.id, message, idempotencyKey: key }, "Platform reply saved.");
    if (saved) {
      delete replyKeys.current[ticket.id];
      setReplyDrafts((current) => ({ ...current, [ticket.id]: "" }));
    }
  }

  async function saveState(ticket: Ticket) {
    const draft = currentDraft(ticket);
    await mutate(ticket.id, { action: "state", ticketId: ticket.id, ...draft }, "Ticket status and priority saved.");
  }

  return (
    <section id="platform-support" className="scroll-mt-28 rounded-3xl border border-green-200 bg-gradient-to-br from-green-50 via-white to-lime-50/70 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-green-200 bg-green-50/90 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-green-800">Communications</p><h2 className="mt-2 flex items-center gap-2 text-xl font-extrabold text-slate-950"><LifeBuoy size={21} className="text-green-800" />Support inbox</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Institute requests and replies are stored in the test database. Notifications are not sent by this workflow.</p></div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="text-xs font-semibold text-slate-600">Status filter<select className={`${inputClass} mt-1 min-w-44`} value={filter} onChange={(event) => { setOffset(0); setFilter(event.target.value as typeof filter); }} disabled={loading || Boolean(busy)}><option value="all">All requests</option>{SUPPORT_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
          <button type="button" onClick={() => void refresh(filter, offset)} disabled={loading || Boolean(busy)} className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh</button>
        </div>
      </div>
      {error && <div role="alert" className="mt-5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}<button type="button" onClick={() => void refresh(filter, offset)} className="ml-auto text-xs font-bold underline">Retry</button></div>}
      {notice && <div role="status" className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{notice}</div>}
      {loading && <div className="py-10 text-center text-sm text-slate-500"><LoaderCircle size={17} className="mr-2 inline animate-spin" />Loading support queue…</div>}
      {!loading && !error && page?.tickets.length === 0 && <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-8 text-center"><MessageSquareText size={23} className="mx-auto text-slate-400" /><p className="mt-3 text-sm font-semibold text-slate-800">No requests in this view</p><p className="mt-1 text-xs text-slate-500">Requests will appear when an institute submits one.</p></div>}
      <div className="mt-5 space-y-4">
        {page?.tickets.map((ticket) => {
          const draft = currentDraft(ticket);
          return <article key={ticket.id} className="overflow-hidden rounded-xl border border-slate-200">
            <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">{ticket.business_name} · {ticket.category}</p><h3 className="mt-1 break-words font-bold text-slate-950">{ticket.subject}</h3><p className="mt-1 text-[11px] text-slate-500">Opened {date(ticket.created_at)} · Updated {date(ticket.updated_at)}</p></div>
              <div className="grid gap-2 sm:min-w-64 sm:grid-cols-2">
                <label className="text-[11px] font-semibold text-slate-600">Status<select className={`${inputClass} mt-1 py-2 text-xs`} value={draft.status} onChange={(event) => setStateDrafts((current) => ({ ...current, [ticket.id]: { ...currentDraft(ticket), status: event.target.value as SupportStatus } }))} disabled={Boolean(busy)}>{SUPPORT_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
                <label className="text-[11px] font-semibold text-slate-600">Priority<select className={`${inputClass} mt-1 py-2 text-xs`} value={draft.priority} onChange={(event) => setStateDrafts((current) => ({ ...current, [ticket.id]: { ...currentDraft(ticket), priority: event.target.value as SupportPriority } }))} disabled={Boolean(busy)}>{SUPPORT_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
                <button type="button" onClick={() => void saveState(ticket)} disabled={Boolean(busy) || (draft.status === ticket.status && draft.priority === ticket.priority)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-40 sm:col-span-2">{busy === ticket.id && <LoaderCircle size={13} className="animate-spin" />}Save status</button>
              </div>
            </div>
            <div className="space-y-3 p-4">{ticket.messages.map((message) => <div key={message.id} className={`rounded-lg p-3 ${message.author_kind === "platform" ? "bg-violet-50" : "bg-slate-50"}`}><div className="flex flex-wrap justify-between gap-2"><span className="text-xs font-bold text-slate-800">{message.author_kind === "platform" ? "Platform Admin" : "Institute"}</span><time className="text-[10px] text-slate-500" dateTime={message.created_at}>{date(message.created_at)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{message.body}</p></div>)}</div>
            {ticket.status !== "closed" && <div className="border-t border-slate-100 p-4"><label className="sr-only" htmlFor={`platform-reply-${ticket.id}`}>Reply to {ticket.business_name}: {ticket.subject}</label><textarea id={`platform-reply-${ticket.id}`} className={`${inputClass} min-h-20 resize-y`} placeholder="Write a reply to the institute" maxLength={4000} value={replyDrafts[ticket.id] ?? ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [ticket.id]: event.target.value }))} disabled={Boolean(busy)} /><button type="button" onClick={() => void reply(ticket)} disabled={Boolean(busy) || !(replyDrafts[ticket.id] ?? "").trim()} className="mt-2 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 disabled:opacity-50"><Send size={13} />Send reply</button></div>}
          </article>;
        })}
      </div>
      {page && page.total > pageSize && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="text-xs text-slate-500">Showing {offset + 1}–{Math.min(offset + pageSize, page.total)} of {page.total}</p><div className="flex gap-2"><button type="button" onClick={() => setOffset((value) => Math.max(0, value - pageSize))} disabled={offset === 0 || loading} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-40">Previous</button><button type="button" onClick={() => setOffset((value) => value + pageSize)} disabled={offset + pageSize >= page.total || loading} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-40">Next</button></div></div>}
    </section>
  );
}
