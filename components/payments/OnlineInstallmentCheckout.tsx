"use client";

import { useRef, useState } from "react";
import { CreditCard, LoaderCircle } from "lucide-react";

type Provider = "razorpay" | "cashfree";
type CheckoutOrder = {
  orderId: string;
  providerOrderId?: string;
  status: string;
  amount?: string | number;
  checkout?: { publicKey?: string; sessionId?: string };
};
type CheckoutMessage = { kind: "success" | "pending" | "error"; text: string };
type ParentCheckoutLink = { orderId: string; url: string; expiresAt: string; installmentId: string };

type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};
type RazorpayInstance = {
  open(): void;
  on(event: "payment.failed", handler: (event: { error?: { description?: string } }) => void): void;
};
type CashfreeResult = { error?: unknown; redirect?: boolean; paymentDetails?: { paymentMessage?: string } };
type CashfreeInstance = { checkout(options: { paymentSessionId: string; redirectTarget: "_modal" }): Promise<CashfreeResult> };
type PendingVerification =
  | { provider: "cashfree"; orderId: string }
  | { provider: "razorpay"; orderId: string; payment: RazorpaySuccess }
  | { provider: "razorpay_order"; orderId: string };

declare global {
  interface Window {
    Razorpay?: new (options: {
      key: string;
      amount: number;
      currency: "INR";
      name: string;
      description: string;
      order_id: string;
      prefill?: { name?: string; email?: string; contact?: string };
      theme: { color: string };
      handler(response: RazorpaySuccess): void;
      modal?: { ondismiss(): void };
    }) => RazorpayInstance;
    Cashfree?: (options: { mode: "sandbox" }) => CashfreeInstance;
  }
}

const scripts = new Map<string, Promise<void>>();

function loadProviderSdk(provider: Provider): Promise<void> {
  const existing = provider === "razorpay" ? window.Razorpay : window.Cashfree;
  if (existing) return Promise.resolve();
  const src = provider === "razorpay"
    ? "https://checkout.razorpay.com/v1/checkout.js"
    : "https://sdk.cashfree.com/js/v3/cashfree.js";
  const pending = scripts.get(src);
  if (pending) return pending;
  const promise = new Promise<void>((resolve, reject) => {
    const oldScript = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const script = oldScript ?? document.createElement("script");
    script.async = true;
    script.src = src;
    script.dataset.bizbookProviderSdk = provider;
    script.onload = () => provider === "razorpay" ? window.Razorpay ? resolve() : reject(new Error("Checkout SDK did not initialize."))
      : window.Cashfree ? resolve() : reject(new Error("Checkout SDK did not initialize."));
    script.onerror = () => reject(new Error("The provider checkout could not be loaded."));
    if (!oldScript) document.head.append(script);
  });
  scripts.set(src, promise);
  void promise.catch(() => scripts.delete(src));
  return promise;
}

async function postJson(url: string, body: unknown, method: "POST" | "DELETE" = "POST"): Promise<{ response: Response; value: Record<string, unknown> }> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The server returned an invalid payment response.");
  return { response, value: value as Record<string, unknown> };
}

function safeMessage(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length < 400 ? value : fallback;
}

export default function OnlineInstallmentCheckout({
  instituteId,
  instituteName,
  branchId,
  studentId,
  studentName,
  parentName,
  parentEmail,
  parentMobile,
  installmentId,
  installmentLabel,
  amount,
  disabled,
  onConfirmed,
}: {
  instituteId: string;
  instituteName: string;
  branchId: string | null;
  studentId: string;
  studentName: string;
  parentName: string | null;
  parentEmail: string | null;
  parentMobile: string | null;
  installmentId: string;
  installmentLabel: string;
  amount: number;
  disabled: boolean;
  onConfirmed: () => void;
}) {
  const [provider, setProvider] = useState<Provider>("razorpay");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<CheckoutMessage | null>(null);
  const [canCheckStatus, setCanCheckStatus] = useState(false);
  const [parentLink, setParentLink] = useState<ParentCheckoutLink | null>(null);
  const pendingVerification = useRef<PendingVerification | null>(null);
  const idempotency = useRef<{ fingerprint: string; key: string }>({ fingerprint: "", key: "" });
  const fingerprint = JSON.stringify([instituteId, branchId, studentId, installmentId, provider, amount]);

  async function syncProviderOrder(orderId: string): Promise<CheckoutMessage> {
    let last: CheckoutMessage = { kind: "pending", text: "Payment is not confirmed yet. Check the provider status before retrying." };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { response, value } = await postJson("/api/payments/sync", { orderId });
      if (response.status === 401 || response.status === 403 || response.status >= 500) {
        throw new Error(safeMessage(value.error, "The server could not verify the payment status."));
      }
      if (value.status === "captured") {
        pendingVerification.current = null;
        setCanCheckStatus(false);
        last = { kind: "success", text: "Payment confirmed by the provider and recorded in the institute ledger." };
        onConfirmed();
        return last;
      }
      if (value.status === "reconciliation_required") {
        pendingVerification.current = null;
        setCanCheckStatus(false);
        return { kind: "error", text: safeMessage(value.error, "This payment needs administrator reconciliation.") };
      }
      if (value.status === "failed" || value.status === "cancelled") {
        pendingVerification.current = null;
        setCanCheckStatus(false);
        idempotency.current = { fingerprint: "", key: "" };
      } else {
        setCanCheckStatus(true);
      }
      last = { kind: "pending", text: safeMessage(value.message, "The provider has not confirmed a captured payment. No receipt was posted.") };
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    return last;
  }

  async function verifyRazorpay(orderId: string, payment: RazorpaySuccess) {
    pendingVerification.current = { provider: "razorpay", orderId, payment };
    setCanCheckStatus(true);
    try {
      const { response, value } = await postJson("/api/payments/verify", {
        orderId,
        paymentId: payment.razorpay_payment_id,
        signature: payment.razorpay_signature,
      });
      if (value.verified === true && value.status === "captured") {
        pendingVerification.current = null;
        setCanCheckStatus(false);
        setMessage({ kind: "success", text: "Payment confirmed by Razorpay and recorded in the institute ledger." });
        onConfirmed();
        return;
      }
      setMessage({ kind: "pending", text: safeMessage(value.message ?? value.error,
        response.status === 202 ? "Razorpay has not confirmed capture. No receipt was posted." : "Payment verification is pending. No receipt was posted.") });
    } catch {
      setMessage({ kind: "error", text: "The checkout response was received, but server verification did not finish. Refresh payment history and reconcile the provider status before retrying." });
    } finally {
      setBusy(false);
    }
  }

  async function retryProviderStatus() {
    const check = pendingVerification.current;
    if (!check || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (check.provider === "cashfree") {
        setMessage(await syncProviderOrder(check.orderId));
      } else if (check.provider === "razorpay_order") {
        setMessage(await syncProviderOrder(check.orderId));
      } else {
        await verifyRazorpay(check.orderId, check.payment);
      }
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Provider status could not be checked." });
    } finally {
      setBusy(false);
    }
  }

  async function startCheckout(mode: "self" | "parent") {
    if (busy || disabled || !Number.isFinite(amount) || amount <= 0) return;
    setBusy(true);
    setMessage(null);
    if (idempotency.current.fingerprint !== fingerprint) {
      idempotency.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      const { response, value } = await postJson("/api/payments/create-order", {
        instituteId,
        branchId,
        studentId,
        provider,
        receiptKind: "Fee",
        amount: amount.toFixed(2),
        installmentId,
        allocationAmount: amount.toFixed(2),
        idempotencyKey: idempotency.current.key,
      });
      if (value.retryStatusCheck === true && typeof value.orderId === "string") {
        pendingVerification.current = { provider: "razorpay_order", orderId: value.orderId };
        setCanCheckStatus(true);
        setMessage({ kind: "pending", text: safeMessage(value.message, "The existing order needs a provider status check before checkout can continue.") });
        return;
      }
      if (!response.ok) throw new Error(safeMessage(value.error, "The payment order could not be created."));
      const order = value as unknown as CheckoutOrder;
      if (order.status === "Captured") {
        pendingVerification.current = null;
        setCanCheckStatus(false);
        setMessage({ kind: "success", text: "This installment payment was already confirmed and recorded." });
        onConfirmed();
        setBusy(false);
        return;
      }
      if (order.status !== "Pending" || !order.orderId) {
        throw new Error(safeMessage(value.error, `The payment order is ${order.status || "unavailable"}. Check payment history before retrying.`));
      }
      if (mode === "parent") {
        const { response: linkResponse, value: linkValue } = await postJson("/api/payments/checkout-links", { orderId: order.orderId });
        if (!linkResponse.ok || typeof linkValue.token !== "string" || typeof linkValue.expiresAt !== "string") {
          throw new Error(safeMessage(linkValue.error, "A secure parent link could not be created."));
        }
        const url = `${window.location.origin}/pay#${linkValue.token}`;
        setParentLink({ orderId: order.orderId, url, expiresAt: linkValue.expiresAt, installmentId });
        setMessage({ kind: "success", text: "Parent checkout link created. It expires in 24 hours and can be revoked." });
        setBusy(false);
        return;
      }
      await loadProviderSdk(provider);
      if (provider === "razorpay") {
        if (!order.providerOrderId || !order.checkout?.publicKey || !window.Razorpay) {
          throw new Error("Razorpay returned an incomplete sandbox checkout response. No payment was opened.");
        }
        const checkout = new window.Razorpay({
          key: order.checkout.publicKey,
          amount: Math.round(amount * 100),
          currency: "INR",
          name: instituteName,
          description: `${installmentLabel} · ${studentName}`,
          order_id: order.providerOrderId,
          prefill: {
            ...(parentName ? { name: parentName } : { name: studentName }),
            ...(parentEmail ? { email: parentEmail } : {}),
            ...(parentMobile ? { contact: parentMobile } : {}),
          },
          theme: { color: "#6d28d9" },
          handler: (payment) => { void verifyRazorpay(order.orderId, payment); },
          modal: { ondismiss: () => setBusy(false) },
        });
        checkout.on("payment.failed", (event) => {
          setBusy(false);
          setMessage({ kind: "pending", text: safeMessage(event.error?.description,
            "The provider reported a failed attempt. No receipt was posted; check payment history before retrying.") });
        });
        checkout.open();
        return;
      }
      if (!order.checkout?.sessionId || !window.Cashfree) {
        throw new Error("Cashfree returned no sandbox payment session. No payment was opened.");
      }
      pendingVerification.current = { provider: "cashfree", orderId: order.orderId };
      setCanCheckStatus(true);
      const cashfree = window.Cashfree({ mode: "sandbox" });
      const result = await cashfree.checkout({ paymentSessionId: order.checkout.sessionId, redirectTarget: "_modal" });
      if (result?.redirect) {
        setMessage({ kind: "pending", text: "Cashfree redirected the checkout. The redirect is not proof of payment; return here and check provider status." });
        setBusy(false);
        return;
      }
      const synced = await syncProviderOrder(order.orderId);
      setMessage(synced);
      setBusy(false);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "The sandbox checkout could not be started." });
      setBusy(false);
    }
  }

  async function copyParentLink() {
    if (!parentLink || parentLink.installmentId !== installmentId) return;
    try {
      await navigator.clipboard.writeText(parentLink.url);
      setMessage({ kind: "success", text: "Parent checkout link copied." });
    } catch {
      setMessage({ kind: "error", text: "Copy access is unavailable. Select and copy the link below." });
    }
  }

  async function revokeParentLink() {
    if (!parentLink || parentLink.installmentId !== installmentId || busy) return;
    setBusy(true);
    try {
      const { response, value } = await postJson("/api/payments/checkout-links", { orderId: parentLink.orderId }, "DELETE");
      if (!response.ok || value.revoked !== true) throw new Error(safeMessage(value.error, "The link is already inactive or could not be revoked."));
      setParentLink(null);
      setMessage({ kind: "success", text: "Parent checkout link revoked." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "The parent link could not be revoked." });
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4" aria-labelledby="online-checkout-title">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-white p-2 text-violet-700"><CreditCard size={18} /></div>
        <div className="min-w-0 flex-1">
          <h3 id="online-checkout-title" className="text-sm font-bold text-slate-800">Online installment checkout</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">The full current installment balance is charged. The database rechecks the amount and access when creating the order.</p>
        </div>
      </div>
      <label className="block text-xs font-semibold text-slate-600">Sandbox provider<select
        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
        value={provider}
        disabled={busy || disabled}
        onChange={(event) => { setProvider(event.target.value as Provider); setMessage(null); }}
      ><option value="razorpay">Razorpay Test</option><option value="cashfree">Cashfree Sandbox</option></select></label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-extrabold text-violet-800">{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount)}</p>
        <button type="button" onClick={() => void startCheckout("self")} disabled={busy || disabled || canCheckStatus || Boolean(parentLink?.installmentId === installmentId)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <><LoaderCircle size={16} className="animate-spin" /> Processing…</> : "Open sandbox checkout here"}
        </button>
      </div>
      <button type="button" onClick={() => void startCheckout("parent")} disabled={busy || disabled || canCheckStatus || Boolean(parentLink?.installmentId === installmentId)}
        className="w-full rounded-xl border border-violet-300 bg-white px-4 py-2.5 text-sm font-bold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50">
        Create parent checkout link
      </button>
      {parentLink?.installmentId === installmentId && <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <label className="block text-xs font-bold text-emerald-900">Share this one-time link with the parent <input readOnly value={parentLink.url} className="mt-1.5 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 font-normal text-slate-700" /></label>
        <p className="text-[11px] text-emerald-900">Expires {new Date(parentLink.expiresAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}. The raw access link is shown only here; anyone holding it can open this sandbox checkout.</p>
        <div className="flex gap-2"><button type="button" onClick={() => void copyParentLink()} className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Copy link</button><button type="button" onClick={() => void revokeParentLink()} disabled={busy} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 disabled:opacity-50">Revoke</button></div>
      </div>}
      {canCheckStatus && <button type="button" onClick={() => void retryProviderStatus()} disabled={busy || disabled}
        className="w-full rounded-xl border border-violet-300 bg-white px-3 py-2.5 text-sm font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Checking provider status…" : "Check provider status"}
      </button>}
      <p className="text-[11px] leading-4 text-slate-500">Test mode only. Saving provider credentials does not activate checkout. Do not use live credentials here.</p>
      {message && <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-lg p-3 text-xs font-semibold ${message.kind === "success" ? "bg-emerald-50 text-emerald-800" : message.kind === "pending" ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-800"}`}>{message.text}</p>}
    </section>
  );
}
