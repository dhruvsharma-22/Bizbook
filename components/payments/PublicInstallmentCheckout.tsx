"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CreditCard, LoaderCircle, ShieldCheck } from "lucide-react";

type Provider = "razorpay" | "cashfree";
type PublicOrder = {
  instituteName: string;
  provider: Provider;
  amount: number | string;
  currency: "INR";
  installmentSequence: number | null;
  dueDate: string | null;
  expiresAt: string | null;
  status: string;
  message?: string;
  checkout?: { providerOrderId: string; publicKey?: string; sessionId?: string; amountMinor: number };
};
type RazorpaySuccess = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type Message = { kind: "error" | "pending" | "success"; text: string };

const sdkLoads = new Map<string, Promise<void>>();

async function loadSdk(provider: Provider): Promise<void> {
  if (provider === "razorpay" ? window.Razorpay : window.Cashfree) return;
  const src = provider === "razorpay"
    ? "https://checkout.razorpay.com/v1/checkout.js"
    : "https://sdk.cashfree.com/js/v3/cashfree.js";
  const existing = sdkLoads.get(src);
  if (existing) return existing;
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.onload = () => provider === "razorpay"
      ? window.Razorpay ? resolve() : reject(new Error("The payment provider did not initialize."))
      : window.Cashfree ? resolve() : reject(new Error("The payment provider did not initialize."));
    script.onerror = () => reject(new Error("The payment provider checkout could not be loaded."));
    document.head.append(script);
  });
  sdkLoads.set(src, loading);
  void loading.catch(() => sdkLoads.delete(src));
  return loading;
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json().catch(() => null);
  return { response, value: value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {} };
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length <= 300 ? value : fallback;
}

export default function PublicInstallmentCheckout() {
  const tokenRef = useRef<string | null>(null);
  const proofRef = useRef<RazorpaySuccess | null>(null);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function loadLink(token: string) {
    const { response, value } = await post("/api/payments/checkout-link/resolve", { token });
    if (!response.ok) throw new Error(safeText(value.error, "This payment link is unavailable."));
    setOrder(value as unknown as PublicOrder);
    if (typeof value.message === "string") setMessage({ kind: "pending", text: safeText(value.message, "The payment status is being checked by the institute.") });
  }

  useEffect(() => {
    let active = true;
    const token = window.location.hash.slice(1);
    if (!token) {
      queueMicrotask(() => {
        if (active) {
          setMessage({ kind: "error", text: "This payment link is incomplete. Ask the institute to send a new link." });
          setLoading(false);
        }
      });
      return () => { active = false; };
    }
    tokenRef.current = token;
    void Promise.resolve().then(() => loadLink(token)).catch((error: unknown) => {
      if (active) setMessage({ kind: "error", text: error instanceof Error ? error.message : "The payment link could not be loaded." });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function verify(proof?: RazorpaySuccess) {
    const token = tokenRef.current;
    if (!token) throw new Error("The payment link is unavailable.");
    const { response, value } = await post("/api/payments/checkout-link/verify", {
      token,
      ...(proof ? { paymentId: proof.razorpay_payment_id, signature: proof.razorpay_signature } : {}),
    });
    if (value.verified === true && value.status === "captured") {
      setOrder((current) => current ? { ...current, status: "Captured" } : current);
      setMessage({ kind: "success", text: "The provider confirmed your payment and the institute recorded the receipt." });
      return;
    }
    if (!response.ok && response.status !== 202) {
      throw new Error(safeText(value.message ?? value.error, "The provider has not confirmed this payment."));
    }
    setMessage({ kind: "pending", text: safeText(value.message, "Payment is not confirmed yet. No receipt was posted." ) });
  }

  async function openCheckout() {
    if (busy || !order?.checkout || !tokenRef.current) return;
    setBusy(true);
    setMessage(null);
    try {
      await loadSdk(order.provider);
      if (order.provider === "razorpay") {
        if (!order.checkout.publicKey || !window.Razorpay) throw new Error("Razorpay checkout data is incomplete.");
        const checkout = new window.Razorpay({
          key: order.checkout.publicKey,
          amount: order.checkout.amountMinor,
          currency: "INR",
          name: order.instituteName,
          description: order.installmentSequence ? `Installment ${order.installmentSequence}` : "Student installment",
          order_id: order.checkout.providerOrderId,
          theme: { color: "#6d28d9" },
          handler: (proof) => {
            proofRef.current = proof;
            void verify(proof).catch((error: unknown) => setMessage({
              kind: "error", text: error instanceof Error ? error.message : "Payment verification is unavailable.",
            }));
          },
          modal: { ondismiss: () => setBusy(false) },
        });
        checkout.on("payment.failed", () => {
          setMessage({ kind: "pending", text: "The provider reported a failed attempt. No receipt was posted." });
          setBusy(false);
        });
        checkout.open();
        return;
      }
      if (!order.checkout.sessionId || !window.Cashfree) throw new Error("Cashfree checkout session is unavailable.");
      const result = await window.Cashfree({ mode: "sandbox" }).checkout({
        paymentSessionId: order.checkout.sessionId, redirectTarget: "_modal",
      });
      if (result?.error || result?.redirect) {
        setMessage({ kind: "pending", text: "Checkout returned without provider proof. Use the status check below; a redirect alone is not payment confirmation." });
      }
      await verify();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Checkout could not be opened." });
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    if (busy) return;
    setBusy(true);
    try {
      await verify(proofRef.current ?? undefined);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Provider status could not be checked." });
    } finally {
      setBusy(false);
    }
  }

  const amount = order?.amount === undefined ? null : Number(order.amount);
  const formattedAmount = amount !== null && Number.isFinite(amount)
    ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount) : "";
  const expiresText = order?.expiresAt ? new Date(order.expiresAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="public-checkout-title">
        <a href="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 hover:text-violet-900"><ArrowLeft size={15} />BizBook</a>
        <div className="mt-6 flex items-center gap-3"><span className="rounded-xl bg-violet-50 p-3 text-violet-700"><CreditCard size={21} /></span>
          <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Secure installment payment</p><h1 id="public-checkout-title" className="text-xl font-extrabold text-slate-900">Pay your institute</h1></div>
        </div>
        {loading && <div className="mt-8 flex items-center gap-2 text-sm text-slate-600"><LoaderCircle className="animate-spin" size={17} />Checking the payment link…</div>}
        {!loading && order && <div className="mt-7 space-y-5">
          <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Institute</p><p className="mt-1 font-bold text-slate-900">{order.instituteName}</p>
            <div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-xs text-slate-500">{order.installmentSequence ? `Installment ${order.installmentSequence}` : "Student installment"}</p>{order.dueDate && <p className="mt-1 text-xs text-slate-500">Due {new Date(`${order.dueDate}T00:00:00`).toLocaleDateString("en-IN")}</p>}</div><p className="text-xl font-extrabold text-slate-900">{formattedAmount}</p></div>
          </div>
          {order.status === "Captured" ? <p className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">This installment has already been paid and confirmed.</p>
            : order.status === "Pending" || order.status === "Processing" || order.status === "Authorized" ? <>
              {expiresText && <p className="text-xs text-slate-500">Link expires {expiresText}. Provider: {order.provider === "razorpay" ? "Razorpay Test" : "Cashfree Sandbox"}.</p>}
              <button type="button" onClick={() => void openCheckout()} disabled={busy || !order.checkout} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60">
                {busy ? <><LoaderCircle className="animate-spin" size={17} />Checking payment…</> : <>Continue to secure checkout<CreditCard size={17} /></>}
              </button>
              <button type="button" onClick={() => void checkStatus()} disabled={busy} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Check payment status</button>
            </> : <p className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">This payment order is no longer available. Contact the institute for a new link.</p>}
          <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-700" />Payment is recorded only after BizBook verifies the provider response. This checkout is test mode and cannot collect live funds.</p>
        </div>}
        {!loading && !order && <div className="mt-7 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{message?.text ?? "This payment link is unavailable."}</div>}
        {message && order && <p role={message.kind === "error" ? "alert" : "status"} className={`mt-4 rounded-lg p-3 text-sm font-semibold ${message.kind === "success" ? "bg-emerald-50 text-emerald-800" : message.kind === "pending" ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-800"}`}>{message.text}</p>}
      </section>
    </main>
  );
}
