"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCheck, CheckCircle2, ChevronRight, LifeBuoy, LoaderCircle, MessageCircle, MessageSquareText, Plus, RefreshCw, Search, Send, ShieldCheck } from "lucide-react";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { SUPPORT_CATEGORIES, type SupportCategory, type SupportStatus } from "@/lib/supabase/support-validation";

type SupportMessage = { id: string; author_user_id: string; author_kind: "institute" | "platform"; body: string; created_at: string };
type SupportTicket = {
  id: string; institute_id: string; category: SupportCategory; subject: string; status: SupportStatus;
  priority: string; created_at: string; updated_at: string; resolved_at: string | null; closed_at: string | null;
  messages: SupportMessage[];
};
type TicketResponse = { total: number; tickets: SupportTicket[] };
const pageSize = 20;

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-600 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:bg-slate-50 disabled:opacity-60";

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function shortDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parsed);
}

function messageTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusStyle(status: SupportStatus) {
  if (status === "resolved" || status === "closed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "waiting_on_customer") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function newRequestKey() {
  return globalThis.crypto.randomUUID();
}

export default function InstituteSupportWorkspace() {
  const workspace = useWorkspaceScope();
  const instituteId = workspace.selection?.instituteId ?? "";
  const [offset, setOffset] = useState(0);
  const [offsetInstituteId, setOffsetInstituteId] = useState("");
  const activeOffset = offsetInstituteId === instituteId ? offset : 0;
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState<SupportCategory>("account");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [activeTicketId, setActiveTicketId] = useState("");
  const [composeMode, setComposeMode] = useState(false);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [search, setSearch] = useState("");
  const requestId = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const createRetry = useRef<{ signature: string; key: string } | null>(null);
  const replyRetries = useRef<Record<string, { signature: string; key: string }>>({});

  const load = useCallback(async (id: string, pageOffset: number) => {
    if (!id) {
      setTickets([]);
      setTicketTotal(0);
      setLoading(false);
      return false;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ instituteId: id, limit: String(pageSize), offset: String(pageOffset) });
      const response = await fetch(`/api/support?${params.toString()}`, { cache: "no-store" });
      const result = await response.json() as { result?: TicketResponse; error?: string };
      if (!response.ok) throw new Error(result.error || "Support requests could not be loaded.");
      if (!result.result || !Array.isArray(result.result.tickets)) throw new Error("The support response was incomplete.");
      if (currentRequest === requestId.current) {
        setTickets(result.result.tickets);
        setTicketTotal(result.result.total);
      }
      return true;
    } catch (cause) {
      if (currentRequest === requestId.current) setError(cause instanceof Error ? cause.message : "Support requests could not be loaded.");
      return false;
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspace.loading) return;
    const timer = window.setTimeout(() => { void load(instituteId, activeOffset); }, 0);
    return () => window.clearTimeout(timer);
  }, [activeOffset, instituteId, load, workspace.loading]);

  const visible = useMemo(() => instituteId ? tickets.filter((ticket) => ticket.institute_id === instituteId) : [], [instituteId, tickets]);
  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return visible;
    return visible.filter((ticket) => `${ticket.subject} ${ticket.category} ${ticket.status} ${ticket.messages[ticket.messages.length - 1]?.body ?? ""}`.toLowerCase().includes(term));
  }, [search, visible]);
  const activeTicket = visible.find((ticket) => ticket.id === activeTicketId) ?? null;

  useEffect(() => {
    if (composeMode || activeTicketId && visible.some((ticket) => ticket.id === activeTicketId)) return;
    setActiveTicketId(visible[0]?.id ?? "");
  }, [activeTicketId, composeMode, visible]);

  useEffect(() => {
    if (!composeMode && activeTicket) messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeTicket, composeMode, mobileThreadOpen]);

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !instituteId) return;
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();
    const signature = JSON.stringify([instituteId, category, trimmedSubject, trimmedMessage]);
    if (createRetry.current?.signature !== signature) createRetry.current = { signature, key: newRequestKey() };
    const idempotencyKey = createRetry.current.key;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/support", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", instituteId, category, subject: trimmedSubject, message: trimmedMessage, idempotencyKey }),
      });
      const result = await response.json() as { ticketId?: string; error?: string };
      if (!response.ok || !result.ticketId) throw new Error(result.error || "The support request was not confirmed.");
      createRetry.current = null;
      setSubject(""); setMessage(""); setCategory("account"); setComposeMode(false);
      setActiveTicketId(result.ticketId);
      setMobileThreadOpen(true);
      setOffset(0); setOffsetInstituteId(instituteId);
      const refreshed = await load(instituteId, 0);
      setNotice(refreshed ? "Your message was sent to BizBook Support." : "Your request was saved, but the inbox could not refresh. Retry loading to confirm it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The support request could not be created.");
    } finally { setBusy(false); }
  }

  async function reply(ticket: SupportTicket) {
    const body = (replies[ticket.id] ?? "").trim();
    if (!body || busy) return;
    const signature = JSON.stringify([ticket.id, body]);
    if (replyRetries.current[ticket.id]?.signature !== signature) {
      replyRetries.current[ticket.id] = { signature, key: newRequestKey() };
    }
    const idempotencyKey = replyRetries.current[ticket.id].key;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/support", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply", ticketId: ticket.id, message: body, idempotencyKey }),
      });
      const result = await response.json() as { messageId?: string; error?: string };
      if (!response.ok || !result.messageId) throw new Error(result.error || "The reply was not confirmed.");
      delete replyRetries.current[ticket.id];
      setReplies((current) => ({ ...current, [ticket.id]: "" }));
      const refreshed = await load(instituteId, activeOffset);
      setNotice(refreshed ? "Your reply was sent." : "Your reply was saved, but the thread could not refresh. Retry loading to confirm it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The reply could not be saved.");
    } finally { setBusy(false); }
  }

  function openComposer() {
    setComposeMode(true);
    setMobileThreadOpen(true);
    setError(""); setNotice("");
  }

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-[#f2f6f7] px-3 py-4 text-slate-900 sm:px-5 sm:py-6 lg:px-7">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-5">
        <header className="relative isolate flex items-start justify-between gap-3 overflow-hidden rounded-3xl bg-gradient-to-br from-[#102c35] via-[#087b68] to-[#16a085] p-4 text-white shadow-[0_20px_48px_-32px_rgba(8,123,104,0.6)] sm:items-center sm:gap-5 sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-32 size-64 rounded-full border border-white/15 bg-white/[0.04]" aria-hidden="true" />
          <div className="relative z-10 min-w-0 flex-1">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-50"><LifeBuoy size={13} /> BizBook assistance</p>
            <h1 className="mt-2 text-xl font-extrabold tracking-tight sm:text-3xl">Support inbox</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-emerald-50/90 sm:text-sm">Message our support team and keep the conversation in one place.</p>
          </div>
          <div className="relative z-10 flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-emerald-50 xl:inline-flex"><ShieldCheck size={14} /> Private institute inbox</span>
            <button type="button" onClick={() => void load(instituteId, activeOffset)} disabled={loading || workspace.loading || !instituteId} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/40 bg-white/15 px-2.5 text-xs font-bold text-white transition hover:bg-white/25 disabled:opacity-60 sm:gap-2 sm:px-3.5 sm:text-sm"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh</button>
          </div>
        </header>

        {workspace.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">Workspace access could not be verified: {workspace.error}</div>}
        {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><MessageSquareText size={17} className="mt-0.5 shrink-0" />{error}</div>}
        {notice && <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{notice}</div>}

        <section aria-label="Support messages" className="grid h-[min(760px,calc(100dvh-220px))] min-h-[560px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_54px_-40px_rgba(15,23,42,0.45)] lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className={`${mobileThreadOpen ? "hidden" : "flex"} min-h-0 flex-col border-r border-slate-200 bg-white lg:flex`}>
            <div className="border-b border-slate-100 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <div><h2 className="text-base font-extrabold text-slate-900">Conversations</h2><p className="mt-0.5 text-xs text-slate-600">{ticketTotal} support {ticketTotal === 1 ? "request" : "requests"}</p></div>
                <button type="button" onClick={openComposer} disabled={!instituteId || workspace.loading} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-700 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"><Plus size={15} /> New message</button>
              </div>
              <label className="relative mt-4 block"><span className="sr-only">Search conversations</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-500 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100" /></label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {workspace.loading || loading ? <div className="p-6 text-center text-sm text-slate-600"><LoaderCircle size={17} className="mr-2 inline animate-spin" />Loading conversations</div>
                : !instituteId ? <p className="p-5 text-center text-sm text-slate-600">Join or create an institute to contact BizBook Support.</p>
                  : filteredTickets.length === 0 ? <div className="px-4 py-9 text-center"><span className="mx-auto grid size-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><MessageCircle size={21} /></span><p className="mt-3 text-sm font-bold text-slate-800">{visible.length ? "No matching conversations" : "No messages yet"}</p><p className="mt-1 text-xs leading-5 text-slate-600">{visible.length ? "Try another search term." : "Start a conversation and our team will reply here."}</p>{!visible.length && <button type="button" onClick={openComposer} className="mt-4 text-xs font-bold text-emerald-800 hover:underline">Send a message</button>}</div>
                    : filteredTickets.map((ticket) => {
                      const latest = ticket.messages[ticket.messages.length - 1];
                      const selected = !composeMode && ticket.id === activeTicket?.id;
                      return <button key={ticket.id} type="button" onClick={() => { setActiveTicketId(ticket.id); setComposeMode(false); setMobileThreadOpen(true); setError(""); setNotice(""); }} aria-current={selected ? "true" : undefined} className={`group flex w-full items-start gap-3 rounded-2xl px-3 py-3.5 text-left transition ${selected ? "bg-emerald-50 ring-1 ring-emerald-100" : "hover:bg-slate-50"}`}>
                        <span className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-extrabold ${selected ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600"}`}>{ticket.subject.trim().charAt(0).toUpperCase() || "B"}</span>
                        <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-slate-900">{ticket.subject}</span><time className="shrink-0 text-[10px] text-slate-500" dateTime={ticket.updated_at}>{shortDate(ticket.updated_at)}</time></span><span className="mt-1 flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-600">{latest?.author_kind === "institute" ? "You: " : "Support: "}{latest?.body ?? "Request submitted"}</span><ChevronRight size={14} className={`shrink-0 ${selected ? "text-emerald-700" : "text-slate-300"}`} /></span><span className="mt-2 inline-flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${ticket.status === "resolved" || ticket.status === "closed" ? "bg-emerald-500" : ticket.status === "waiting_on_customer" ? "bg-amber-500" : "bg-sky-500"}`} /><span className="text-[10px] font-semibold capitalize text-slate-600">{titleCase(ticket.status)}</span><span className="text-[10px] text-slate-300">·</span><span className="text-[10px] capitalize text-slate-600">{ticket.category}</span></span></span>
                      </button>;
                    })}
            </div>
            {!loading && ticketTotal > pageSize && <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><span className="text-[10px] text-slate-600">{activeOffset + 1}–{Math.min(activeOffset + pageSize, ticketTotal)} of {ticketTotal}</span><span className="flex gap-1.5"><button type="button" onClick={() => { setOffsetInstituteId(instituteId); setOffset(Math.max(0, activeOffset - pageSize)); }} disabled={activeOffset === 0 || loading} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 disabled:opacity-40">Previous</button><button type="button" onClick={() => { setOffsetInstituteId(instituteId); setOffset(activeOffset + pageSize); }} disabled={activeOffset + pageSize >= ticketTotal || loading} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 disabled:opacity-40">Next</button></span></div>}
          </aside>

          <div className={`${mobileThreadOpen ? "flex" : "hidden"} min-h-0 min-w-0 flex-col lg:flex`}>
            {composeMode ? <>
              <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-6"><button type="button" onClick={() => { setComposeMode(false); setMobileThreadOpen(false); }} className="grid size-9 place-items-center rounded-full text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Back to conversations"><ArrowLeft size={19} /></button><span className="grid size-10 place-items-center rounded-full bg-emerald-100 text-emerald-800"><MessageCircle size={19} /></span><div><h2 className="text-sm font-extrabold text-slate-900">New support request</h2><p className="text-xs text-slate-600">BizBook Support usually replies in this inbox</p></div></div>
              <form onSubmit={createTicket} className="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.07)_0,transparent_24%),radial-gradient(circle_at_85%_65%,rgba(148,163,184,0.09)_0,transparent_25%),#f7faf9] p-4 sm:p-6">
                <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4">
                  <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm sm:p-5"><p className="text-xs font-bold uppercase tracking-wide text-emerald-800">How can we help?</p><p className="mt-1 text-xs leading-5 text-slate-600">Your message stays in this private institute support thread. Never include passwords, OTPs, or full payment details.</p></div>
                  <label className="block text-xs font-bold text-slate-600">Topic<select className={`${inputClass} mt-1.5`} value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)} disabled={busy || !instituteId}>{SUPPORT_CATEGORIES.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label>
                  <label className="block text-xs font-bold text-slate-600">Subject<input className={`${inputClass} mt-1.5`} value={subject} onChange={(event) => setSubject(event.target.value)} minLength={5} maxLength={120} required disabled={busy || !instituteId} placeholder="Briefly describe the issue" /></label>
                  <label className="block text-xs font-bold text-slate-600">Message<textarea className={`${inputClass} mt-1.5 min-h-36 resize-y`} value={message} onChange={(event) => setMessage(event.target.value)} minLength={20} maxLength={4000} required disabled={busy || !instituteId} placeholder="Share what happened and what you need help with…" /></label>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setComposeMode(false); setMobileThreadOpen(false); }} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button><button type="submit" disabled={busy || workspace.loading || !instituteId || subject.trim().length < 5 || message.trim().length < 20} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />} Send to support</button></div>
                  {!workspace.loading && !workspace.error && !instituteId && <p className="text-xs text-amber-800">No active institute membership is available for support.</p>}
                </div>
              </form>
            </> : activeTicket ? <>
              <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:px-5">
                <button type="button" onClick={() => setMobileThreadOpen(false)} className="grid size-9 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Back to conversations"><ArrowLeft size={19} /></button>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-700 text-sm font-extrabold text-white">B</span>
                <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-extrabold text-slate-900">{activeTicket.subject}</h2><p className="mt-0.5 truncate text-[11px] text-slate-600">BizBook Support · {titleCase(activeTicket.category)} · Updated {date(activeTicket.updated_at)}</p></div>
                <span className={`hidden shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold sm:inline-flex ${statusStyle(activeTicket.status)}`}>{titleCase(activeTicket.status)}</span>
                <button type="button" onClick={() => void load(instituteId, activeOffset)} disabled={loading || busy} aria-label="Refresh conversation" className="grid size-9 shrink-0 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
              </div>
              <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/80 px-4 py-2 text-[11px] font-medium text-emerald-900 sm:px-6"><ShieldCheck size={14} /> Messages are visible to authorized members of this institute.</div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[radial-gradient(circle_at_12px_12px,rgba(15,118,110,0.045)_1.2px,transparent_1.3px),linear-gradient(135deg,#f5faf8,#f0f5f5)] bg-[length:24px_24px,auto] px-3 py-5 sm:px-6 sm:py-7">
                <div className="mx-auto mb-4 w-fit rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[10px] font-medium text-slate-600 shadow-sm">Request opened {date(activeTicket.created_at)}</div>
                {activeTicket.messages.map((entry) => {
                  const isInstitute = entry.author_kind === "institute";
                  return <div key={entry.id} className={`flex w-full ${isInstitute ? "justify-end" : "justify-start"}`}>
                    <article className={`max-w-[92%] rounded-2xl px-3.5 py-3 shadow-[0_2px_6px_rgba(15,23,42,0.06)] sm:max-w-[78%] ${isInstitute ? "rounded-br-md border border-emerald-100 bg-[#dcf8c6]" : "rounded-bl-md border border-white bg-white"}`}>
                      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${isInstitute ? "justify-end" : "justify-start"}`}><p className={`text-[11px] font-extrabold ${isInstitute ? "text-emerald-900" : "text-slate-800"}`}>{isInstitute ? "You" : "BizBook Support"}</p><time className="text-[9px] text-slate-600" dateTime={entry.created_at}>{date(entry.created_at)}</time></div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{entry.body}</p>
                      <div className={`mt-1 flex items-center gap-1.5 ${isInstitute ? "justify-end text-emerald-700" : "justify-start text-slate-500"}`}><time className="text-[9px]" dateTime={entry.created_at}>{messageTime(entry.created_at)}</time>{isInstitute && <CheckCheck size={13} aria-label="Sent" />}</div>
                    </article>
                  </div>;
                })}
                <div ref={messagesEndRef} aria-hidden="true" />
              </div>
              {activeTicket.status !== "closed" ? <form onSubmit={(event) => { event.preventDefault(); void reply(activeTicket); }} className="border-t border-slate-200 bg-white p-3 sm:px-5 sm:py-4">
                <label className="sr-only" htmlFor={`reply-${activeTicket.id}`}>Reply to {activeTicket.subject}</label>
                <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-emerald-400 focus-within:ring-4 focus-within:ring-emerald-50"><textarea id={`reply-${activeTicket.id}`} className="max-h-36 min-h-11 flex-1 resize-y bg-transparent px-2 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-500" placeholder="Write a message…" value={replies[activeTicket.id] ?? ""} onChange={(event) => setReplies((current) => ({ ...current, [activeTicket.id]: event.target.value }))} maxLength={4000} disabled={busy} /><button type="submit" disabled={busy || !(replies[activeTicket.id] ?? "").trim()} aria-label="Send reply" className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-700 text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Send size={17} />}</button></div>
                <p className="mt-2 px-1 text-[10px] text-slate-500">Replies are saved to this thread. No email or WhatsApp alert is sent.</p>
              </form> : <div className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-600"><CheckCircle2 size={15} className="mr-1 inline text-emerald-700" />This conversation is closed. Start a new message if you need more help.</div>}
            </> : <div className="hidden min-h-0 flex-1 flex-col items-center justify-center bg-[radial-gradient(circle_at_12px_12px,rgba(15,118,110,0.045)_1.2px,transparent_1.3px),linear-gradient(135deg,#f5faf8,#f0f5f5)] bg-[length:24px_24px,auto] px-6 text-center lg:flex">
              <span className="grid size-16 place-items-center rounded-3xl bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100"><MessageCircle size={29} /></span><h2 className="mt-5 text-lg font-extrabold text-slate-900">Your support conversations</h2><p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">Choose a conversation from the left or start a new message. Replies will stay together in this inbox.</p><button type="button" onClick={openComposer} disabled={!instituteId || workspace.loading} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"><Plus size={16} /> New message</button>
            </div>}
          </div>
        </section>
      </div>
    </main>
  );
}
