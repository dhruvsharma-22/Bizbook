"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Membership = {
  instituteId: string;
  instituteName: string;
  role: "owner" | "administrator" | "accountant" | "staff";
};

type Provider = "razorpay" | "cashfree";
type Connection = {
  id: string;
  provider: Provider;
  merchant_account_reference: string | null;
  environment: "test" | "production";
  connection_status: "inactive" | "pending" | "active" | "disabled";
  updated_at: string;
};

type CredentialFields = {
  keyId: string;
  keySecret: string;
  razorpayWebhookSecret: string;
  clientId: string;
  clientSecret: string;
  cashfreeWebhookSecret: string;
};

const blankCredentials: CredentialFields = {
  keyId: "",
  keySecret: "",
  razorpayWebhookSecret: "",
  clientId: "",
  clientSecret: "",
  cashfreeWebhookSecret: "",
};

const inputClass = "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-[#5B21B6] focus:ring-2 focus:ring-violet-100";
const configured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
);

export default function IntegrationsPage() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [selectedInstituteId, setSelectedInstituteId] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionsInstituteId, setConnectionsInstituteId] = useState("");
  const [credentials, setCredentials] = useState<CredentialFields>(blankCredentials);
  const [loading, setLoading] = useState(configured);
  const [savingProvider, setSavingProvider] = useState<Provider | "">("");
  const [checkingProvider, setCheckingProvider] = useState<Provider | "">("");
  const [verificationByProvider, setVerificationByProvider] = useState<Partial<Record<Provider, string>>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const managers = useMemo(
    () => memberships.filter((item) => item.role === "owner" || item.role === "administrator"),
    [memberships],
  );
  const loadConnections = useCallback(async (instituteId: string) => {
    if (!instituteId) {
      setConnections([]);
      setConnectionsInstituteId("");
      return;
    }
    const response = await fetch(`/api/admin/payment-connections?instituteId=${encodeURIComponent(instituteId)}`, {
      cache: "no-store",
    });
    const result = await response.json() as { connections?: Connection[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not load payment settings.");
    setConnections(result.connections ?? []);
    setConnectionsInstituteId(instituteId);
  }, []);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) throw new Error("Sign in with an institute owner or administrator account.");

        const { data: rows, error: membershipError } = await supabase
          .from("user_memberships")
          .select("institute_id, role")
          .eq("user_id", authData.user.id)
          .eq("is_active", true);
        if (membershipError) throw new Error("Could not load institute access.");

        const managerRows = (rows ?? []).filter((row) => row.role === "owner" || row.role === "administrator");
        if (!managerRows.length) {
          if (active) setMemberships([]);
          return;
        }
        const { data: institutes, error: instituteError } = await supabase
          .from("coaching_institutes")
          .select("id, business_name")
          .in("id", managerRows.map((row) => row.institute_id));
        if (instituteError) throw new Error("Could not load institute details.");
        const names = new Map((institutes ?? []).map((institute) => [institute.id, institute.business_name]));
        const available = managerRows.flatMap((row) => {
          const instituteName = names.get(row.institute_id);
          return instituteName ? [{ instituteId: row.institute_id, instituteName, role: row.role }] : [];
        });
        if (active) {
          setMemberships(available);
          setSelectedInstituteId((current) => available.some((item) => item.instituteId === current)
            ? current
            : available[0]?.instituteId ?? "");
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load payment settings.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedInstituteId) return;
    let active = true;
    // The state updates happen after the awaited network response in loadConnections.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConnections(selectedInstituteId).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load payment settings.");
    });
    return () => { active = false; };
  }, [loadConnections, selectedInstituteId]);

  async function saveCredentials(event: FormEvent<HTMLFormElement>, provider: Provider) {
    event.preventDefault();
    if (!selectedInstituteId || savingProvider || checkingProvider) return;
    setSavingProvider(provider);
    setError("");
    setNotice("");
    const providerCredentials = provider === "razorpay"
      ? { keyId: credentials.keyId, keySecret: credentials.keySecret, webhookSecret: credentials.razorpayWebhookSecret }
      : { clientId: credentials.clientId, clientSecret: credentials.clientSecret, webhookSecret: credentials.cashfreeWebhookSecret };

    try {
      const response = await fetch("/api/admin/payment-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instituteId: selectedInstituteId, provider, credentials: providerCredentials }),
      });
      const result = await response.json() as { error?: string; verified?: boolean };
      if (!response.ok) throw new Error(result.error || "Could not save provider credentials.");
      setCredentials(blankCredentials);
      setNotice(`${provider === "razorpay" ? "Razorpay" : "Cashfree"} test credentials were encrypted and saved. ${verificationByProvider[provider] ? "The sandbox API check passed for the entered credentials; the saved connection remains pending until webhook verification." : "The provider has not been verified, so checkout remains disabled."}`);
      await loadConnections(selectedInstituteId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save provider credentials.");
    } finally {
      setSavingProvider("");
    }
  }

  async function verifyCredentials(provider: Provider) {
    if (!selectedInstituteId || savingProvider || checkingProvider) return;
    const confirmed = window.confirm(
      "This sends the entered test credentials to the provider from the server, creates an unpaid INR 1.00 sandbox order, and stores the credentials in Supabase Vault if the check succeeds. It does not open checkout or attempt a payment. Continue?",
    );
    if (!confirmed) return;

    setCheckingProvider(provider);
    setError("");
    setNotice("");
    const providerCredentials = provider === "razorpay"
      ? { keyId: credentials.keyId, keySecret: credentials.keySecret, webhookSecret: credentials.razorpayWebhookSecret }
      : { clientId: credentials.clientId, clientSecret: credentials.clientSecret, webhookSecret: credentials.cashfreeWebhookSecret };
    try {
      const response = await fetch("/api/admin/payment-connections/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instituteId: selectedInstituteId, provider, credentials: providerCredentials }),
      });
      const result = await response.json() as {
        verified?: boolean;
        activated?: boolean;
        connectionStatus?: string;
        error?: string;
        providerOrderId?: string;
        orderStatus?: string;
      };
      if (!response.ok && !result.verified) {
        throw new Error(result.error || "The sandbox credential check did not complete.");
      }
      if (!result.verified) throw new Error(result.error || "The sandbox credential check did not complete.");
      if (!result.activated) {
        setError(result.error || "The provider API check passed, but the connection remains pending.");
        await loadConnections(selectedInstituteId);
        return;
      }
      const confirmation = result.activated && result.providerOrderId
        ? `Sandbox credentials were verified and stored in Vault. Unpaid INR 1.00 order ${result.providerOrderId} was created (${result.orderStatus}). Test-mode connection is active; webhook delivery is still unverified.`
        : result.error || "The provider check did not activate the connection.";
      setVerificationByProvider((current) => ({ ...current, [provider]: confirmation }));
      await loadConnections(selectedInstituteId);
    } catch (reason) {
      setVerificationByProvider((current) => ({ ...current, [provider]: undefined }));
      setError(reason instanceof Error ? reason.message : "The sandbox credential check did not complete.");
    } finally {
      setCheckingProvider("");
    }
  }

  const connectionFor = (provider: Provider) => connectionsInstituteId === selectedInstituteId
    ? connections.find((connection) => connection.provider === provider)
    : undefined;

  return (
    <WorkspaceLayout>
      <main className="p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <header>
            <p className="text-sm font-semibold text-[#5B21B6]">Institute settings</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Online payment integrations</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Configure test-mode gateways for this coaching institute. Offline cash, UPI, bank-transfer, card, cheque, and other payments are recorded separately under Payments &amp; Collections → Record Manual Payment. Gateway credentials are submitted to the server and stored with Supabase Vault; they are never sent back to this page.
            </p>
          </header>

          {!configured && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Connect the workspace to the authorized test Supabase project before configuring integrations.
            </section>
          )}

          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
          {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}

          {configured && loading && (
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
              <LoaderCircle size={17} className="animate-spin" /> Loading institute access…
            </div>
          )}

          {configured && !loading && managers.length === 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Payment integrations can be managed by an institute owner or administrator. No eligible membership was found for this account.
            </section>
          )}

          {managers.length > 0 && (
            <>
              {managers.length > 1 && <label className="block max-w-xl text-sm font-semibold text-slate-700">
                Institute
                <select value={selectedInstituteId} onChange={(event) => { setSelectedInstituteId(event.target.value); setError(""); setNotice(""); setVerificationByProvider({}); }} className={inputClass}>
                  {managers.map((membership) => <option key={membership.instituteId} value={membership.instituteId}>{membership.instituteName}</option>)}
                </select>
              </label>}

              <div className="grid gap-5 lg:grid-cols-2">
                <GatewayCard
                  title="Razorpay"
                  description="Use API keys generated in Razorpay Test Mode. Live key IDs are rejected by this screen."
                  provider="razorpay"
                  connection={connectionFor("razorpay")}
                  saving={savingProvider === "razorpay"}
                  disabled={Boolean(savingProvider || checkingProvider) || !selectedInstituteId}
                  credentials={credentials}
                  setCredentials={(value) => {
                    setCredentials(value);
                    setVerificationByProvider((current) => ({ ...current, razorpay: undefined }));
                  }}
                  checking={checkingProvider === "razorpay"}
                  verification={verificationByProvider.razorpay}
                  onVerify={verifyCredentials}
                  onSubmit={saveCredentials}
                />
                <GatewayCard
                  title="Cashfree Payments"
                  description="Use sandbox app credentials. The server fixes the current API version and sandbox environment."
                  provider="cashfree"
                  connection={connectionFor("cashfree")}
                  saving={savingProvider === "cashfree"}
                  disabled={Boolean(savingProvider || checkingProvider) || !selectedInstituteId}
                  credentials={credentials}
                  setCredentials={(value) => {
                    setCredentials(value);
                    setVerificationByProvider((current) => ({ ...current, cashfree: undefined }));
                  }}
                  checking={checkingProvider === "cashfree"}
                  verification={verificationByProvider.cashfree}
                  onVerify={verifyCredentials}
                  onSubmit={saveCredentials}
                />
              </div>

              <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-sm leading-6 text-violet-950">
                <h2 className="font-semibold">Central BizBook reminders</h2>
                <p className="mt-1">
                  Email and WhatsApp provider credentials are managed once by BizBook platform administrators. Institute administrators cannot replace the company sender. Central configuration is being prepared at <code>/platform-admin</code>; scheduled reminders remain unavailable until the reviewed test migration and provider verification are complete.
                </p>
              </section>
            </>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 text-[#5B21B6]" size={21} />
              <div>
                <h2 className="font-semibold text-slate-900">Connection and payment status</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Saving credentials alone records them as <strong>pending</strong>. A successful sandbox check stores the credentials in Vault and activates test-mode order operations; it creates only an unpaid INR 1.00 sandbox order. The webhook secret and webhook delivery still need separate end-to-end verification.
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Do not register callback URLs yet: the payment and delivery webhook routes are not active. Supabase Google OAuth and email/phone OTP are configured at the Supabase Auth project level.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </WorkspaceLayout>
  );
}

function GatewayCard({
  title,
  description,
  provider,
  connection,
  saving,
  disabled,
  credentials,
  setCredentials,
  checking,
  verification,
  onVerify,
  onSubmit,
}: {
  title: string;
  description: string;
  provider: Provider;
  connection?: Connection;
  saving: boolean;
  disabled: boolean;
  credentials: CredentialFields;
  setCredentials: (value: CredentialFields) => void;
  checking: boolean;
  verification?: string;
  onVerify: (provider: Provider) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>, provider: Provider) => void;
}) {
  const pending = connection?.connection_status === "pending";
  const statusLabel = pending
    ? "Credentials saved · verification required"
    : connection?.connection_status === "active"
      ? "Marked active by server"
      : connection?.connection_status === "disabled"
        ? "Disabled"
        : "Not configured";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${pending ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
          {pending ? <CircleAlert size={14} /> : <KeyRound size={14} />}{statusLabel}
        </span>
      </div>
      {connection && <p className="mt-3 text-xs text-slate-500">Environment: {connection.environment}. {connection.merchant_account_reference ? `Account: ${connection.merchant_account_reference}` : ""}</p>}

      <form onSubmit={(event) => onSubmit(event, provider)} className="mt-5 space-y-3">
        {provider === "razorpay" ? (
          <>
            <CredentialInput label="Test key ID" value={credentials.keyId} onChange={(value) => setCredentials({ ...credentials, keyId: value })} autoComplete="off" />
            <CredentialInput label="Test key secret" value={credentials.keySecret} onChange={(value) => setCredentials({ ...credentials, keySecret: value })} secret />
            <CredentialInput label="Webhook secret" value={credentials.razorpayWebhookSecret} onChange={(value) => setCredentials({ ...credentials, razorpayWebhookSecret: value })} secret />
          </>
        ) : (
          <>
            <CredentialInput label="Sandbox app ID" value={credentials.clientId} onChange={(value) => setCredentials({ ...credentials, clientId: value })} autoComplete="off" />
            <CredentialInput label="Sandbox client secret" value={credentials.clientSecret} onChange={(value) => setCredentials({ ...credentials, clientSecret: value })} secret />
            <CredentialInput label="Webhook secret" value={credentials.cashfreeWebhookSecret} onChange={(value) => setCredentials({ ...credentials, cashfreeWebhookSecret: value })} secret />
          </>
        )}
        <p className="flex items-center gap-1.5 text-xs text-slate-500"><CheckCircle2 size={14} className="text-emerald-700" /> Test credentials only. Values are not retained in browser storage. A check creates an unpaid INR 1.00 sandbox order.</p>
        {verification && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">{verification}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled || saving || checking} onClick={() => onVerify(provider)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#5B21B6] bg-white px-4 py-2.5 text-sm font-semibold text-[#5B21B6] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
            {checking && <LoaderCircle size={16} className="animate-spin" />}{checking ? "Checking sandbox…" : "Verify sandbox credentials"}
          </button>
          <button type="submit" disabled={disabled || saving || checking} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B21B6] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4C1D95] disabled:cursor-not-allowed disabled:opacity-50">
          {saving && <LoaderCircle size={16} className="animate-spin" />}{saving ? "Saving securely…" : "Save test credentials"}
          </button>
        </div>
      </form>
    </section>
  );
}

function CredentialInput({
  label,
  value,
  onChange,
  secret = false,
  autoComplete = "new-password",
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  secret?: boolean;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        required={required}
        type={secret ? "password" : "text"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        maxLength={4096}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </label>
  );
}
