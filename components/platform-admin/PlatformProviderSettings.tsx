"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Banknote,
  BellRing,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FlaskConical,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

type ProviderScope = "payment" | "email" | "whatsapp";
type Provider = "razorpay" | "cashfree" | "resend" | "whatsapp_cloud";
type Connection = {
  provider_scope: ProviderScope;
  provider: Provider;
  account_reference: string | null;
  environment: "test";
  connection_status: "inactive" | "pending" | "active" | "disabled";
  last_verified_at: string | null;
  receipt_delivery_enabled: boolean;
  updated_at: string;
};
type Field = { key: string; label: string; secret?: boolean; hint?: string; optional?: boolean };
type ProviderCardDefinition = {
  scope: ProviderScope;
  provider: Provider;
  title: string;
  eyebrow: string;
  intro: string;
  fields: Field[];
  icon: LucideIcon;
  iconClass: string;
};

const cards: ProviderCardDefinition[] = [
  {
    scope: "payment", provider: "razorpay", title: "Razorpay", eyebrow: "Subscription payments",
    intro: "Sandbox credentials for future BizBook subscription billing. Saving does not create an order or charge.",
    icon: WalletCards, iconClass: "bg-violet-50 text-violet-800",
    fields: [
      { key: "key_id", label: "Test key ID" },
      { key: "key_secret", label: "Test key secret", secret: true },
      { key: "webhook_secret", label: "Webhook secret", secret: true },
      { key: "account_reference", label: "Merchant reference", hint: "Optional internal account label." },
    ],
  },
  {
    scope: "payment", provider: "cashfree", title: "Cashfree", eyebrow: "Subscription payments",
    intro: "Sandbox app credentials for future BizBook subscription billing. Checkout and live mode are not enabled.",
    icon: Banknote, iconClass: "bg-violet-50 text-violet-800",
    fields: [
      { key: "client_id", label: "Sandbox app ID" },
      { key: "client_secret", label: "Sandbox client secret", secret: true },
      { key: "webhook_secret", label: "Webhook secret", secret: true },
      { key: "account_reference", label: "Merchant reference", hint: "Optional internal account label." },
    ],
  },
  {
    scope: "email", provider: "resend", title: "BizBook email", eyebrow: "Central notification channel",
    intro: "Company sender for email notices and optional fee receipt PDFs. Saving credentials does not send a receipt.",
    icon: Mail, iconClass: "bg-emerald-50 text-emerald-800",
    fields: [
      { key: "api_key", label: "Resend API key", secret: true },
      { key: "from_email", label: "Verified sender address" },
      { key: "sender_name", label: "Sender name" },
      { key: "webhook_signing_secret", label: "Webhook signing secret", secret: true },
    ],
  },
  {
    scope: "whatsapp", provider: "whatsapp_cloud", title: "WhatsApp Business", eyebrow: "Central notification channel",
    intro: "Company WhatsApp sender for approved reminders and fee receipt PDFs sent only to opted-in recipients.",
    icon: MessageCircle, iconClass: "bg-green-50 text-green-800",
    fields: [
      { key: "access_token", label: "Access token", secret: true },
      { key: "phone_number_id", label: "Sender phone number ID" },
      { key: "business_account_id", label: "Business account ID" },
      { key: "app_secret", label: "Meta app secret", secret: true },
      { key: "webhook_verify_token", label: "Webhook verify token", secret: true },
      { key: "api_version", label: "Graph API version", hint: "For example, v23.0." },
      { key: "template_name", label: "Approved reminder template" },
      { key: "template_language", label: "Template language" },
      { key: "receipt_template_name", label: "Approved PDF receipt template", optional: true, hint: "Use an approved template with a document header and five body placeholders in order: student, receipt number, institute, amount, date." },
      { key: "receipt_template_language", label: "PDF receipt template language", optional: true, hint: "Required together with the template name when enabling WhatsApp receipts." },
      { key: "subscription_template_name", label: "Approved BizBook subscription reminder template", optional: true, hint: "Separate from the student fee template. Use five body placeholders in order: coaching name, plan, BizBook, renewal date, amount." },
      { key: "subscription_template_language", label: "Subscription reminder template language", optional: true, hint: "Required together with the subscription template name to send BizBook renewal reminders on WhatsApp." },
    ],
  },
];

const inputClass = "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#6D28D9] focus:ring-4 focus:ring-violet-100/70 disabled:bg-slate-50";

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(connection: Connection | undefined, loading: boolean, error: string): string {
  if (loading) return "Loading";
  if (error) return "Unavailable";
  if (!connection) return "Not configured";
  return connection.connection_status.replaceAll("_", " ");
}

function statusClass(connection: Connection | undefined, loading: boolean, error: string): string {
  if (error) return "border-slate-200 bg-slate-100 text-slate-600";
  if (loading) return "border-violet-200 bg-violet-50 text-violet-700";
  if (!connection) return "border-slate-200 bg-slate-100 text-slate-600";
  if (connection.connection_status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (connection.connection_status === "disabled" || connection.connection_status === "inactive") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

export default function PlatformProviderSettings() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [canConfigureProviders, setCanConfigureProviders] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/platform-admin/providers", { cache: "no-store" });
      const result = await response.json() as { connections?: Connection[]; canConfigureProviders?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || "Central provider settings are unavailable.");
      setConnections(result.connections ?? []);
      setCanConfigureProviders(result.canConfigureProviders === true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Central provider settings are unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads persisted metadata from the authenticated API.
    void refresh();
  }, [refresh]);

  const available = !error && !loading;
  const pendingCount = connections.filter((item) => item.connection_status === "pending").length;
  const activeCount = connections.filter((item) => item.connection_status === "active").length;
  const configuredCount = connections.length;
  const summary = [
    { label: "Saved configurations", value: loading ? "—" : error ? "Unavailable" : String(configuredCount), detail: "Provider metadata in the test database", icon: ShieldCheck, iconClass: "bg-violet-50 text-violet-800" },
    { label: "Pending review", value: loading ? "—" : error ? "Unavailable" : String(pendingCount), detail: "Saved, but not verified for use", icon: Clock3, iconClass: "bg-amber-50 text-amber-800" },
    { label: "Active states", value: loading ? "—" : error ? "Unavailable" : String(activeCount), detail: "Current server-recorded status", icon: CheckCircle2, iconClass: "bg-emerald-50 text-emerald-800" },
  ];

  return (
    <div className="space-y-10">
      <section id="platform-overview" className="scroll-mt-28 rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-blue-50/70 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/80 p-4 sm:flex-row sm:items-center sm:p-5">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-950">Configuration overview</h2>
            <p className="mt-1 text-sm text-slate-600">Live metadata from the authorized test database.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 sm:self-auto">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />{loading ? "Refreshing…" : "Refresh status"}
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {summary.map(({ label, value, detail, icon: Icon, iconClass }) => (
            <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_-24px_rgba(15,23,42,0.35)] sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-sm font-semibold text-slate-600">{label}</p><p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950" aria-live="polite">{value}</p></div>
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconClass}`}><Icon size={19} /></span>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">{detail}</p>
            </article>
          ))}
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50/80 p-4 sm:p-5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#5B21B6] shadow-sm"><LockKeyhole size={17} /></span>
          <div><h3 className="text-sm font-bold text-violet-950">Sandbox controls are enforced</h3><p className="mt-1 text-sm leading-6 text-violet-900/80">Saving stores encrypted test credentials and keeps the configuration pending. This form does not create a payment, send a message, or verify a provider connection.</p></div>
        </div>

        {error && <div role="alert" className="mt-5 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3"><CircleAlert size={18} className="mt-0.5 shrink-0 text-rose-700" /><div><h3 className="text-sm font-bold text-rose-900">Provider metadata could not be loaded</h3><p className="mt-1 text-sm text-rose-800">{error}</p></div></div>
          <button type="button" onClick={() => void refresh()} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-rose-200 bg-white px-3 text-xs font-bold text-rose-900 hover:bg-rose-100 sm:self-auto"><RefreshCw size={13} />Try again</button>
        </div>}

        {available && configuredCount === 0 && <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-5 py-4 text-sm text-slate-600">
          No central provider configurations are saved yet. Add test credentials below when the test database migration and Vault prerequisites are ready.
        </div>}
      </section>

      <ProviderSection
        id="payment-providers"
        title="Payment providers"
        description="Test-only settings for future BizBook subscription checkout. Student fee collection uses its separate institute workflow."
        icon={WalletCards}
        cards={cards.filter((card) => card.scope === "payment")}
        connections={connections}
        canConfigureProviders={canConfigureProviders}
        loading={loading}
        error={error}
        onRefresh={refresh}
        onSaved={(message) => { setNotice(message); void refresh(); }}
        onError={setError}
      />

      <ProviderSection
        id="messaging-providers"
        title="Messaging providers"
        description="Central BizBook sender settings for institute reminders. Reminder delivery also needs an enabled schedule, recipient consent, a verified active sender, and a scheduled server job."
        icon={BellRing}
        cards={cards.filter((card) => card.scope !== "payment")}
        connections={connections}
        canConfigureProviders={canConfigureProviders}
        loading={loading}
        error={error}
        onRefresh={refresh}
        onSaved={(message) => { setNotice(message); void refresh(); }}
        onError={setError}
      />

      <section id="security-posture" className="scroll-mt-28 rounded-3xl border border-teal-200 bg-gradient-to-br from-teal-50 via-white to-emerald-50/70 p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3 rounded-2xl border border-teal-100 bg-teal-50/80 p-4 sm:p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white"><ShieldCheck size={18} /></span>
          <div><h2 className="text-lg font-bold tracking-tight text-slate-950">Security and access</h2><p className="mt-1 text-sm text-slate-600">Controls applied to this platform configuration surface.</p></div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <SecurityNote title="Role checked on the server" description="This route and its API verify the signed-in platform administrator against the database. A coaching workspace role is not sufficient." />
          <SecurityNote title="Secrets stay server-side" description="Credential values are sent to the authenticated API and stored through Supabase Vault. The browser receives configuration metadata only." />
          <SecurityNote title="No live actions here" description="The current console accepts test settings only. It has no control to activate live payment, trigger a charge, or send a real notification." />
        </div>
      </section>

      {notice && <div role="status" className="fixed bottom-4 right-4 z-30 flex max-w-[min(92vw,480px)] items-start gap-3 rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-emerald-950 shadow-xl sm:bottom-6 sm:right-6">
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-700" /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification" className="ml-1 rounded-md px-1 text-emerald-800 hover:bg-emerald-50">×</button>
      </div>}
    </div>
  );
}

function ProviderSection({ id, title, description, icon: Icon, cards: sectionCards, connections, canConfigureProviders, loading, error, onRefresh, onSaved, onError }: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  cards: ProviderCardDefinition[];
  connections: Connection[];
  canConfigureProviders: boolean;
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <section id={id} className={`scroll-mt-28 rounded-3xl border p-5 shadow-sm sm:p-6 ${id === "payment-providers" ? "border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50/70" : "border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-purple-50/70"}`}>
      <header className={`mb-5 flex items-start gap-3 rounded-2xl border p-4 sm:p-5 ${id === "payment-providers" ? "border-rose-200 bg-rose-50/90" : "border-fuchsia-200 bg-fuchsia-50/90"}`}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-white shadow-sm ${id === "payment-providers" ? "border-rose-200 text-rose-800" : "border-fuchsia-200 text-fuchsia-800"}`}><Icon size={18} /></span>
        <div><h2 className="text-lg font-bold tracking-tight text-slate-950">{title}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p></div>
      </header>
      <div className="grid items-start gap-5 2xl:grid-cols-2">
        {sectionCards.map((card) => (
          <ProviderCard key={`${card.scope}:${card.provider}`} {...card}
            connection={connections.find((item) => item.provider_scope === card.scope && item.provider === card.provider)}
            canConfigureProviders={canConfigureProviders}
            loading={loading} loadError={error} onSaved={onSaved} onError={onError} onRefresh={onRefresh}
          />
        ))}
      </div>
    </section>
  );
}

function ProviderCard({ scope, provider, title, eyebrow, intro, fields, icon: Icon, iconClass, connection, canConfigureProviders, loading, loadError, onSaved, onError, onRefresh }: ProviderCardDefinition & {
  connection?: Connection;
  canConfigureProviders: boolean;
  loading: boolean;
  loadError: string;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [receiptSettingBusy, setReceiptSettingBusy] = useState(false);
  const savedAt = formatTimestamp(connection?.updated_at);
  const verifiedAt = formatTimestamp(connection?.last_verified_at);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!window.confirm(`Save ${title} credentials in test mode? This does not send a message or make a payment.`)) return;
    setSaving(true);
    onError("");
    try {
      const response = await fetch("/api/platform-admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerScope: scope, provider, credentials: values }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save central provider settings.");
      setValues({});
      onSaved(`${title} credentials were saved in test mode as pending. No provider connection or delivery is being claimed.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not save central provider settings.");
    } finally {
      setSaving(false);
    }
  }

  async function verify() {
    if (verifying || !connection || !canConfigureProviders) return;
    const operation = scope === "payment"
      ? "create a synthetic unpaid INR 1 sandbox order"
      : scope === "email"
        ? "send one test email to Resend's reserved test inbox"
        : "read the configured WhatsApp phone profile (no message will be sent)";
    if (!window.confirm(`Run this ${title} provider check? It will ${operation}. The connection will remain pending.`)) return;
    setVerifying(true);
    onError("");
    try {
      const response = await fetch("/api/platform-admin/providers/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerScope: scope, provider, confirmed: true }),
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "Provider check failed.");
      onSaved(`${result.message || `${title} provider check passed.`} Status remains pending until the relevant verified workflow is complete.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Provider check failed.");
    } finally {
      setVerifying(false);
    }
  }

  async function toggleReceiptDelivery() {
    if (!connection || !canConfigureProviders || receiptSettingBusy || !["email", "whatsapp"].includes(scope)) return;
    const enabled = !connection.receipt_delivery_enabled;
    const channelName = scope === "whatsapp" ? "WhatsApp" : "Email";
    if (!window.confirm(`${enabled ? "Enable" : "Disable"} automatic fee receipt PDFs through ${channelName}? Only future receipts with separate recipient consent will be sent. This uses the configured test sender.`)) return;
    setReceiptSettingBusy(true);
    onError("");
    try {
      const response = await fetch("/api/platform-admin/providers/receipt-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerScope: scope, enabled }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not update fee receipt delivery.");
      onSaved(`${channelName} fee receipt delivery ${enabled ? "enabled" : "disabled"} for the test sender.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not update fee receipt delivery.");
    } finally {
      setReceiptSettingBusy(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_38px_-30px_rgba(15,23,42,0.42)]">
      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClass}`}><Icon size={20} /></span>
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</p><h3 className="mt-1 text-lg font-bold tracking-tight text-slate-950">{title}</h3><p className="mt-1.5 max-w-xl text-xs leading-5 text-slate-600 sm:text-sm">{intro}</p></div>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold capitalize sm:text-xs ${statusClass(connection, loading, loadError)}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${loadError ? "bg-slate-400" : loading ? "animate-pulse bg-violet-500" : connection?.connection_status === "active" ? "bg-emerald-500" : connection ? "bg-amber-500" : "bg-slate-400"}`} />
            {statusLabel(connection, loading, loadError)}
          </span>
        </div>
        {connection && <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          <span>Environment: <strong className="font-semibold text-slate-700">{connection.environment}</strong></span>
          {connection.account_reference && <span>Account: <strong className="font-semibold text-slate-700">{connection.account_reference}</strong></span>}
          {savedAt && <span>Updated {savedAt}</span>}
          <span>{verifiedAt ? `Last API check ${verifiedAt}` : "No provider API check recorded"}</span>
        </div>}
      </div>

      {(scope === "email" || scope === "whatsapp") && connection && <div className="mx-5 mt-5 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 sm:mx-6 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-bold text-emerald-950">Automatic fee receipt PDFs</p><p className="mt-1 text-xs leading-5 text-emerald-900/80">{connection.receipt_delivery_enabled ? "Enabled for opted-in recipients." : "Disabled. Configure and verify the sender, then enable delivery here."} WhatsApp uses an approved document-header template.</p></div>
        <button type="button" onClick={() => void toggleReceiptDelivery()} disabled={!canConfigureProviders || receiptSettingBusy || loading || (!connection.receipt_delivery_enabled && (connection.connection_status !== "pending" || !connection.last_verified_at))} className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${connection.receipt_delivery_enabled ? "border-rose-200 bg-white text-rose-700 hover:bg-rose-50" : "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"}`}>
          {receiptSettingBusy ? <LoaderCircle size={14} className="animate-spin" /> : <BellRing size={14} />}{connection.receipt_delivery_enabled ? "Disable receipts" : "Enable receipts"}
        </button>
      </div>}

      <form onSubmit={submit} className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.key} className="block text-xs font-semibold text-slate-700">
              <span className="flex items-center gap-1.5">{field.label}{field.secret && <LockKeyhole size={12} className="text-slate-400" />}{(field.key === "account_reference" || field.optional) && <span className="font-normal text-slate-400">Optional</span>}</span>
              <input className={inputClass} type={field.secret ? "password" : "text"} autoComplete={field.secret ? "new-password" : "off"} autoCapitalize="none" spellCheck={false} maxLength={4096} required={field.key !== "account_reference" && !field.optional} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
              {field.hint && <span className="mt-1.5 block text-[11px] font-normal leading-4 text-slate-500">{field.hint}</span>}
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-[11px] leading-5 text-slate-500">Secret fields are write-only. Saved values are not read back into this form.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={() => void onRefresh()} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh</button>
            {connection?.connection_status === "pending" && <button type="button" onClick={() => void verify()} disabled={verifying || saving || loading || !canConfigureProviders} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 text-xs font-bold text-violet-900 disabled:cursor-not-allowed disabled:opacity-55">
              {verifying ? <LoaderCircle size={15} className="animate-spin" /> : <FlaskConical size={14} />}{verifying ? "Checking provider…" : "Run test check"}
            </button>}
            <button type="submit" disabled={saving || loading || !canConfigureProviders} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#5B21B6] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#4C1D95] focus:outline-none focus:ring-4 focus:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-55">
              {saving ? <LoaderCircle size={15} className="animate-spin" /> : <LockKeyhole size={14} />}{saving ? "Saving securely…" : "Save test credentials"}
            </button>
          </div>
        </div>
        {!canConfigureProviders && !loading && <p className="text-xs text-slate-500">Only a platform owner can change or verify provider settings.</p>}
      </form>
    </article>
  );
}

function SecurityNote({ title, description }: { title: string; description: string }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-slate-900"><ShieldCheck size={16} className="text-emerald-700" /><h3 className="text-sm font-bold">{title}</h3></div><p className="mt-2 text-xs leading-5 text-slate-600">{description}</p></article>;
}
