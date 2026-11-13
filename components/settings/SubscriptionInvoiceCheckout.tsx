"use client";

import { useRef, useState } from "react";
import { CreditCard, LoaderCircle, RefreshCw } from "lucide-react";

type Provider = "razorpay" | "cashfree";
type CheckoutAttempt = {
  attemptId: string;
  providerOrderId?: string;
  provider: Provider;
  checkout?: { publicKey?: string; sessionId?: string };
};
type RazorpaySuccess = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type Notice = { kind: "pending" | "error" | "success"; message: string };

const sdkPromises = new Map<Provider, Promise<void>>();

async function loadSdk(provider: Provider): Promise<void> {
  if (provider === "razorpay" ? window.Razorpay : window.Cashfree) return;
  const current = sdkPromises.get(provider);
  if (current) return current;
  const source = provider === "razorpay"
    ? "https://checkout.razorpay.com/v1/checkout.js"
    : "https://sdk.cashfree.com/js/v3/cashfree.js";
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.querySelector<HTMLScriptElement>(`script[src="${source}"]`) ?? document.createElement("script");
    const existing = Boolean(script.src);
    script.async = true;
    script.src = source;
    script.onload = () => provider === "razorpay" ? window.Razorpay ? resolve() : reject(new Error("Razorpay checkout did not initialize."))
      : window.Cashfree ? resolve() : reject(new Error("Cashfree checkout did not initialize."));
    script.onerror = () => reject(new Error("The provider checkout could not be loaded."));
    if (!existing) document.head.append(script);
  });
  sdkPromises.set(provider, pending);
  void pending.catch(() => sdkPromises.delete(provider));
  return pending;
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const raw: unknown = await response.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The server returned an invalid response.");
  return { response, value: raw as Record<string, unknown> };
}

function messageFrom(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length <= 300 ? value : fallback;
}

export function SubscriptionInvoiceCheckout({
  invoiceId, amount, instituteName, existingAttemptId, existingProvider, onUpdated, onPaid,
}: {
  invoiceId: string; amount: number; instituteName: string;
  existingAttemptId?: string; existingProvider?: Provider; onUpdated(): void; onPaid?(): void;
}) {
  const [provider, setProvider] = useState<Provider>(existingProvider ?? "razorpay");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [hasRazorpayCallback, setHasRazorpayCallback] = useState(false);
  const retryKey = useRef<{ fingerprint: string; key: string }>({ fingerprint: "", key: "" });
  const pendingAttempt = useRef<CheckoutAttempt | null>(null);
  const pendingRazorpay = useRef<RazorpaySuccess | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState(existingAttemptId ?? null);

  async function verify(attempt: CheckoutAttempt, payment?: RazorpaySuccess) {
    const body = { attemptId: attempt.attemptId,
      ...(payment ? { paymentId: payment.razorpay_payment_id, signature: payment.razorpay_signature,
        providerOrderId: payment.razorpay_order_id } : {}) };
    const { response, value } = await postJson("/api/platform-billing/verify", body);
    if (value.verified === true && value.status === "paid") {
      pendingAttempt.current = null;
      pendingRazorpay.current = null;
      setActiveAttemptId(null);
      setHasRazorpayCallback(false);
      retryKey.current = { fingerprint: "", key: "" };
      setNotice({ kind: "success", message: "Payment verified. Your plan is now active." });
      if (onPaid) onPaid(); else onUpdated();
      return;
    }
    if (value.status === "reconciliation_required") {
      pendingAttempt.current = null;
      setActiveAttemptId(null);
      setHasRazorpayCallback(false);
      setNotice({ kind: "error", message: messageFrom(value.error, "This payment needs BizBook support reconciliation. Workspace access was not activated." ) });
      onUpdated();
      return;
    }
    if (value.status === "failed" || value.status === "cancelled") {
      retryKey.current = { fingerprint: "", key: "" };
      pendingAttempt.current = null;
      setActiveAttemptId(null);
      setHasRazorpayCallback(false);
      setNotice({ kind: "error", message: `The provider reports ${value.status}. Your plan was not activated.` });
      onUpdated();
      return;
    }
    setNotice({ kind: "pending", message: messageFrom(value.message,
      response.status === 202 ? "The provider has not confirmed payment yet. Your plan is still pending." : "Payment verification is pending." ) });
  }

  async function startCheckout() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const fingerprint = `${invoiceId}|${provider}`;
    if (!activeAttemptId && retryKey.current.fingerprint !== fingerprint) retryKey.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const { response, value } = await postJson("/api/platform-billing/create-order", {
        invoiceId, provider,
        ...(activeAttemptId ? { attemptId: activeAttemptId } : { idempotencyKey: retryKey.current.key }),
      });
      if (!response.ok) {
        if (typeof value.attemptId === "string") setActiveAttemptId(value.attemptId);
        throw new Error(messageFrom(value.error, "The subscription payment order could not be created."));
      }
      if (value.status === "paid") {
        setNotice({ kind: "success", message: "This plan payment is already confirmed." });
        if (onPaid) onPaid(); else onUpdated();
        return;
      }
      if (value.requiresStatusCheck === true && typeof value.attemptId === "string") {
        const attempt: CheckoutAttempt = { attemptId: value.attemptId, provider,
          providerOrderId: typeof value.providerOrderId === "string" ? value.providerOrderId : undefined };
        pendingAttempt.current = attempt;
        setActiveAttemptId(attempt.attemptId);
        if (provider === "razorpay") setHasRazorpayCallback(true);
        setNotice({ kind: "pending", message: messageFrom(value.message,
          "The existing provider order needs a status check before checkout can continue.") });
        await verify(attempt);
        return;
      }
      if (value.status !== "pending" || typeof value.attemptId !== "string") {
        throw new Error("The payment attempt is not ready for checkout.");
      }
      const attempt: CheckoutAttempt = {
        attemptId: value.attemptId,
        providerOrderId: typeof value.providerOrderId === "string" ? value.providerOrderId : undefined,
        provider,
        checkout: value.checkout && typeof value.checkout === "object" ? value.checkout as CheckoutAttempt["checkout"] : undefined,
      };
      pendingAttempt.current = attempt;
      setActiveAttemptId(attempt.attemptId);
      await loadSdk(provider);
      if (provider === "razorpay") {
        if (!attempt.providerOrderId || !attempt.checkout?.publicKey || !window.Razorpay) {
          throw new Error("Razorpay did not return a complete sandbox checkout session.");
        }
        const checkout = new window.Razorpay({
          key: attempt.checkout.publicKey,
          amount: Math.round(amount * 100),
          currency: "INR",
          name: instituteName,
          description: "BizBook subscription plan",
          order_id: attempt.providerOrderId,
          theme: { color: "#6d28d9" },
          handler: (result) => {
            pendingRazorpay.current = result;
            setHasRazorpayCallback(true);
            void verify(attempt, result).catch(() => setNotice({ kind: "pending", message: "Checkout returned, but server verification is still pending. Check payment status before relying on workspace access." }));
          },
          modal: { ondismiss: () => setNotice({ kind: "pending", message: "Checkout closed before payment was confirmed. Your plan has not changed." }) },
        });
        checkout.on("payment.failed", () => setNotice({ kind: "error", message: "The provider reported a failed attempt. Your plan was not activated." }));
        checkout.open();
        return;
      }
      if (!attempt.checkout?.sessionId || !window.Cashfree) throw new Error("Cashfree did not return a sandbox payment session.");
      const cashfree = window.Cashfree({ mode: "sandbox" });
      await cashfree.checkout({ paymentSessionId: attempt.checkout.sessionId, redirectTarget: "_modal" });
      setNotice({ kind: "pending", message: "Checkout returned. Confirm the provider status before your plan can activate." });
      await verify(attempt);
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "The sandbox checkout could not be started." });
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    const attempt = pendingAttempt.current;
    if (!attempt || busy) return;
    setBusy(true);
    setNotice(null);
    try { await verify(attempt, attempt.provider === "razorpay" ? pendingRazorpay.current ?? undefined : undefined); }
    catch (error) { setNotice({ kind: "error", message: error instanceof Error ? error.message : "Provider status could not be checked." }); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor={`provider-${invoiceId}`}>Payment provider</label>
        <select id={`provider-${invoiceId}`} value={provider} disabled={busy || Boolean(activeAttemptId)}
          onChange={(event) => { setProvider(event.target.value as Provider); setNotice(null); }}
          className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500">
          <option value="razorpay">Razorpay sandbox</option><option value="cashfree">Cashfree sandbox</option>
        </select>
        <button type="button" onClick={() => void startCheckout()} disabled={busy}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-violet-700 px-3 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50">
          {busy ? <><LoaderCircle size={15} className="animate-spin" /> Verifying…</> : <><CreditCard size={15} /> {activeAttemptId ? "Resume secure payment" : "Pay securely"}</>}
        </button>
        {activeAttemptId && (provider === "cashfree" || hasRazorpayCallback) && <button type="button" onClick={() => void checkStatus()} disabled={busy}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-violet-300 bg-white px-3 text-sm font-semibold text-violet-800 disabled:opacity-50">
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Check provider status
        </button>}
        <button type="button" onClick={onUpdated} disabled={busy}
          className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Refresh payment status</button>
      </div>
      {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-xs leading-5 ${notice.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : notice.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{notice.message}</p>}
      <p className="text-[11px] leading-4 text-slate-500">Authorized test project only. Provider must have test credentials and a successful sandbox check. This does not initiate a live charge.</p>
    </div>
  );
}
