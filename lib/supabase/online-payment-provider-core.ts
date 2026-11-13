import type { PaymentProvider } from "./payment-connection-validation";
import { paiseToRupees, rupeesToPaise } from "./online-payment-core";

export type ProviderCredentials = {
  key_id?: string;
  key_secret?: string;
  client_id?: string;
  client_secret?: string;
  webhook_secret?: string;
};

export type ProviderOrderResult = {
  providerOrderId: string;
  checkoutSession?: string;
  publicKey?: string;
  providerStatus?: "created" | "attempted" | "paid";
};

export type ProviderPaymentState = {
  providerOrderId: string;
  providerPaymentId: string;
  status: "captured" | "authorized" | "pending" | "failed" | "cancelled";
  amount: string;
  currency: string;
};

export type ProviderOrderPaymentState = ProviderPaymentState[];
export type ProviderRefundStatus = "processing" | "completed" | "failed" | "cancelled";
export type ProviderRefundState = {
  providerRefundId: string;
  providerPaymentId: string;
  providerOrderId: string;
  amount: string;
  currency: string;
  status: ProviderRefundStatus;
};

export class PaymentProviderError extends Error {
  constructor(public readonly code: "credentials_unavailable" | "provider_unavailable" | "provider_rejected") {
    super(code);
    this.name = "PaymentProviderError";
  }
}

type CashfreeCustomer = { id: string; name: string; email: string; phone: string };
type FetchLike = typeof fetch;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function amountMatches(raw: unknown, paise: number): boolean {
  const actual = rupeesToPaise(raw as string | number);
  return actual === paise;
}

type RazorpayOrder = {
  id: string;
  receipt: string;
  amount: number;
  amount_paid: number;
  currency: "INR";
  status: "created" | "attempted" | "paid";
};

function parseRazorpayOrder(
  value: unknown,
  expected: { localOrderId?: string; amountPaise?: number; providerOrderId?: string },
): RazorpayOrder {
  const order = object(value);
  const notes = object(order?.notes);
  const expectedReceipt = expected.localOrderId ? `bb_${expected.localOrderId}` : undefined;
  if (!order || typeof order.id !== "string" || !order.id.startsWith("order_")
      || (expected.providerOrderId && order.id !== expected.providerOrderId)
      || typeof order.receipt !== "string" || order.receipt.length > 40
      || (expectedReceipt && order.receipt !== expectedReceipt)
      || (expected.localOrderId && notes?.bizbook_order_id !== expected.localOrderId)
      || typeof order.amount !== "number" || !Number.isSafeInteger(order.amount) || order.amount <= 0
      || (expected.amountPaise !== undefined && order.amount !== expected.amountPaise)
      || typeof order.amount_paid !== "number" || !Number.isSafeInteger(order.amount_paid)
      || order.amount_paid < 0 || order.amount_paid > order.amount
      || order.currency !== "INR"
      || (order.status !== "created" && order.status !== "attempted" && order.status !== "paid")
      || (order.status === "created" && order.amount_paid !== 0)
      || (order.status === "paid" && order.amount_paid !== order.amount)) {
    throw new PaymentProviderError("provider_rejected");
  }
  return order as RazorpayOrder;
}

async function fetchRazorpayOrder(input: {
  credentials: ProviderCredentials;
  providerOrderId?: string;
  localOrderId?: string;
  amountPaise?: number;
  fetcher: FetchLike;
}): Promise<RazorpayOrder | null> {
  if (!isProviderCredentialsValid("razorpay", input.credentials)) {
    throw new PaymentProviderError("credentials_unavailable");
  }
  const path = input.providerOrderId
    ? `/v1/orders/${encodeURIComponent(input.providerOrderId)}`
    : `/v1/orders?receipt=${encodeURIComponent(`bb_${input.localOrderId}`)}&count=100`;
  try {
    const response = await input.fetcher(`https://api.razorpay.com${path}`, {
      method: "GET", headers: { ...authHeaders("razorpay", input.credentials), Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const value = await providerJson(response);
    if (input.providerOrderId) {
      return parseRazorpayOrder(value, input);
    }
    if (!Array.isArray(value.items)) throw new PaymentProviderError("provider_unavailable");
    const exactMatches = value.items.filter((item) => object(item)?.receipt === `bb_${input.localOrderId}`);
    if (exactMatches.length === 0) return null;
    if (exactMatches.length !== 1) throw new PaymentProviderError("provider_rejected");
    return parseRazorpayOrder(exactMatches[0], input);
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("provider_unavailable");
  }
}

function providerRefundId(provider: PaymentProvider, localRefundId: string): string {
  const compact = localRefundId.replaceAll("-", "");
  if (!/^[a-f0-9]{32}$/i.test(compact)) throw new PaymentProviderError("provider_rejected");
  return provider === "cashfree" ? `bb${compact}` : `bb_${compact}`;
}

function refundStatus(provider: PaymentProvider, value: unknown): ProviderRefundStatus {
  if (provider === "razorpay") {
    return value === "processed" ? "completed" : value === "failed" ? "failed" : "processing";
  }
  return value === "SUCCESS" ? "completed"
    : value === "REJECTED" ? "failed"
      : value === "CANCELLED" ? "cancelled" : "processing";
}

function validateRefund(
  provider: PaymentProvider,
  value: Record<string, unknown>,
  expected: { localRefundId: string; providerPaymentId: string; providerOrderId: string; amountPaise: number },
): ProviderRefundState {
  const amountRaw = provider === "razorpay" ? value.amount : value.refund_amount;
  const currencyRaw = provider === "razorpay" ? value.currency : value.refund_currency;
  const paymentRaw = provider === "razorpay" ? value.payment_id : value.cf_payment_id;
  const orderRaw = provider === "razorpay" ? value.order_id : value.order_id;
  const providerIdRaw = provider === "razorpay" ? value.id : value.cf_refund_id;
  const amountValid = provider === "razorpay"
    ? typeof amountRaw === "number" && Number.isSafeInteger(amountRaw) && amountRaw === expected.amountPaise
    : amountMatches(amountRaw as number | string, expected.amountPaise);
  if (providerIdRaw === undefined || providerIdRaw === null
    || String(paymentRaw ?? "") !== expected.providerPaymentId
    || (orderRaw !== undefined && orderRaw !== null && String(orderRaw) !== expected.providerOrderId)
    || (provider === "cashfree" && String(orderRaw ?? "") !== expected.providerOrderId)
    || (provider === "razorpay" && typeof value.receipt === "string"
      && value.receipt !== providerRefundId("razorpay", expected.localRefundId))
    || !amountValid
    || currencyRaw !== "INR") {
    throw new PaymentProviderError("provider_rejected");
  }
  const merchantRefundId = provider === "cashfree" ? value.refund_id : value.id;
  if (provider === "cashfree" && merchantRefundId !== providerRefundId(provider, expected.localRefundId)) {
    throw new PaymentProviderError("provider_rejected");
  }
  return {
    providerRefundId: String(providerIdRaw),
    providerPaymentId: expected.providerPaymentId,
    providerOrderId: expected.providerOrderId,
    amount: paiseToRupees(expected.amountPaise)!,
    currency: "INR",
    status: refundStatus(provider, value.status ?? value.refund_status),
  };
}

export async function createProviderRefund(input: {
  provider: PaymentProvider;
  credentials: ProviderCredentials;
  localRefundId: string;
  providerPaymentId: string;
  providerOrderId: string;
  amount: string;
  reason: string;
  fetcher?: FetchLike;
}): Promise<ProviderRefundState> {
  const amountPaise = rupeesToPaise(input.amount);
  if (!isProviderCredentialsValid(input.provider, input.credentials)) {
    throw new PaymentProviderError("credentials_unavailable");
  }
  if (amountPaise === null
    || amountPaise < 100 || !input.providerPaymentId || !input.providerOrderId
    || !input.reason.trim() || input.reason.length > 500) {
    throw new PaymentProviderError("provider_rejected");
  }
  const fetcher = input.fetcher ?? fetch;
  const common = { ...input, amountPaise, fetcher };
  const signal = AbortSignal.timeout(10_000);
  try {
    if (input.provider === "razorpay") {
      const externalRefundId = providerRefundId("razorpay", input.localRefundId);
      const response = await fetcher(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refund`, {
        method: "POST",
        headers: { ...authHeaders("razorpay", input.credentials), "Content-Type": "application/json", Accept: "application/json",
          "X-Refund-Idempotency": input.localRefundId },
        body: JSON.stringify({ amount: amountPaise, receipt: externalRefundId,
          notes: { bizbook_refund_id: input.localRefundId } }),
        cache: "no-store", redirect: "error", signal,
      });
      const refund = await providerJson(response);
      return validateRefund(input.provider, refund, common);
    }

    const externalRefundId = providerRefundId("cashfree", input.localRefundId);
    const response = await fetcher(`https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(input.providerOrderId)}/refunds`, {
      method: "POST",
      headers: { ...authHeaders("cashfree", input.credentials), "Content-Type": "application/json",
        Accept: "application/json", "x-idempotency-key": input.localRefundId },
      body: JSON.stringify({ refund_amount: Number(paiseToRupees(amountPaise)), refund_id: externalRefundId,
        // Cashfree sandbox treats status words in refund_note as test controls.
        // Keep the provider note deterministic and separate from a user-entered reason.
        refund_note: `BizBook refund ${input.localRefundId.slice(0, 8)}`, refund_speed: "STANDARD" }),
      cache: "no-store", redirect: "error", signal,
    });
    const refund = await providerJson(response);
    return validateRefund(input.provider, refund, common);
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("provider_unavailable");
  }
}

export async function fetchProviderRefund(input: {
  provider: PaymentProvider;
  credentials: ProviderCredentials;
  localRefundId: string;
  providerPaymentId: string;
  providerOrderId: string;
  providerRefundId: string;
  amount: string;
  fetcher?: FetchLike;
}): Promise<ProviderRefundState | null> {
  const amountPaise = rupeesToPaise(input.amount);
  if (!isProviderCredentialsValid(input.provider, input.credentials)) {
    throw new PaymentProviderError("credentials_unavailable");
  }
  if (amountPaise === null || !input.providerRefundId) throw new PaymentProviderError("provider_rejected");
  const fetcher = input.fetcher ?? fetch;
  const expected = { ...input, amountPaise };
  try {
    if (input.provider === "cashfree") {
      const response = await fetcher(
        `https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(input.providerOrderId)}/refunds/${encodeURIComponent(providerRefundId("cashfree", input.localRefundId))}`,
        { method: "GET", headers: { ...authHeaders("cashfree", input.credentials), Accept: "application/json" },
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) },
      );
      if (response.status === 404) return null;
      const state = validateRefund(input.provider, await providerJson(response), expected);
      if (state.providerRefundId !== input.providerRefundId) throw new PaymentProviderError("provider_rejected");
      return state;
    }
    const response = await fetcher(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refunds/${encodeURIComponent(input.providerRefundId)}`, {
      method: "GET", headers: { ...authHeaders("razorpay", input.credentials), Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    const refund = await providerJson(response);
    return validateRefund(input.provider, refund, expected);
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("provider_unavailable");
  }
}

export function isProviderCredentialsValid(provider: PaymentProvider, credentials: ProviderCredentials): boolean {
  return provider === "razorpay"
    ? Boolean(credentials.key_id?.startsWith("rzp_test_") && credentials.key_secret && credentials.webhook_secret)
    : Boolean(credentials.client_id && credentials.client_secret && credentials.webhook_secret);
}

function authHeaders(provider: PaymentProvider, credentials: ProviderCredentials): Record<string, string> {
  if (provider === "razorpay") {
    return { Authorization: `Basic ${Buffer.from(`${credentials.key_id}:${credentials.key_secret}`).toString("base64")}` };
  }
  return {
    "x-client-id": credentials.client_id!,
    "x-client-secret": credentials.client_secret!,
    "x-api-version": "2025-01-01",
  };
}

async function providerJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new PaymentProviderError("credentials_unavailable");
    if (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500) {
      throw new PaymentProviderError("provider_unavailable");
    }
    throw new PaymentProviderError("provider_rejected");
  }
  const value = object(await response.json().catch(() => null));
  if (!value) throw new PaymentProviderError("provider_unavailable");
  return value;
}

export async function createProviderOrder(input: {
  provider: PaymentProvider;
  credentials: ProviderCredentials;
  localOrderId: string;
  amount: string;
  customer?: CashfreeCustomer;
  fetcher?: FetchLike;
}): Promise<ProviderOrderResult> {
  const { provider, credentials, localOrderId } = input;
  const fetcher = input.fetcher ?? fetch;
  const amountPaise = rupeesToPaise(input.amount);
  if (!isProviderCredentialsValid(provider, credentials) || !amountPaise || !/^[a-zA-Z0-9_-]{8,64}$/.test(localOrderId)) {
    throw new PaymentProviderError("credentials_unavailable");
  }
  const signal = AbortSignal.timeout(10_000);
  try {
    if (provider === "razorpay") {
      const response = await fetcher("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { ...authHeaders(provider, credentials), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: `bb_${localOrderId}`,
          notes: { bizbook_order_id: localOrderId } }),
        cache: "no-store", redirect: "error", signal,
      });
      const order = await providerJson(response);
      if (typeof order.id !== "string" || !order.id.startsWith("order_")
          || order.status !== "created" || order.amount !== amountPaise
          || order.amount_paid !== 0 || order.currency !== "INR"
          || order.receipt !== `bb_${localOrderId}`
          || object(order.notes)?.bizbook_order_id !== localOrderId) {
        throw new PaymentProviderError("provider_unavailable");
      }
      return { providerOrderId: order.id, publicKey: credentials.key_id, providerStatus: "created" };
    }

    const customer = input.customer;
    if (!customer || !customer.id || !customer.name || !customer.email || !/^\+?[1-9]\d{7,14}$/.test(customer.phone)) {
      throw new PaymentProviderError("provider_rejected");
    }
    const amount = paiseToRupees(amountPaise)!;
    const response = await fetcher("https://sandbox.cashfree.com/pg/orders", {
      method: "POST",
      headers: { ...authHeaders(provider, credentials), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ order_id: localOrderId, order_amount: Number(amount), order_currency: "INR",
        customer_details: { customer_id: customer.id, customer_name: customer.name,
          customer_email: customer.email, customer_phone: customer.phone } }),
      cache: "no-store", redirect: "error", signal,
    });
    const order = await providerJson(response);
    if (order.order_id !== localOrderId || order.order_status !== "ACTIVE"
        || typeof order.payment_session_id !== "string" || !order.payment_session_id
        || !amountMatches(order.order_amount, amountPaise) || order.order_currency !== "INR") {
      throw new PaymentProviderError("provider_unavailable");
    }
    return { providerOrderId: localOrderId, checkoutSession: order.payment_session_id };
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("provider_unavailable");
  }
}

export async function retrieveProviderCheckout(input: {
  provider: PaymentProvider;
  credentials: ProviderCredentials;
  providerOrderId: string;
  localOrderId?: string;
  amount?: string;
  fetcher?: FetchLike;
}): Promise<ProviderOrderResult> {
  if (input.provider === "razorpay") {
    const fetcher = input.fetcher ?? fetch;
    const parsedAmountPaise = input.amount === undefined ? undefined : rupeesToPaise(input.amount);
    if (parsedAmountPaise === null) throw new PaymentProviderError("provider_rejected");
    const amountPaise = parsedAmountPaise;
    const order = await fetchRazorpayOrder({ credentials: input.credentials,
      providerOrderId: input.providerOrderId, localOrderId: input.localOrderId, amountPaise, fetcher });
    if (!order) throw new PaymentProviderError("provider_unavailable");
    return { providerOrderId: order.id, publicKey: input.credentials.key_id, providerStatus: order.status };
  }
  if (!isProviderCredentialsValid(input.provider, input.credentials)) throw new PaymentProviderError("credentials_unavailable");
  const fetcher = input.fetcher ?? fetch;
  try {
    const expectedAmountPaise = input.amount === undefined ? undefined : rupeesToPaise(input.amount);
    if (expectedAmountPaise === null) throw new PaymentProviderError("provider_rejected");
    const response = await fetcher(`https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(input.providerOrderId)}`, {
      method: "GET", headers: { ...authHeaders("cashfree", input.credentials), Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const order = await providerJson(response);
    if (order.order_id !== input.providerOrderId
        || (input.localOrderId !== undefined && order.order_id !== input.localOrderId)
        || typeof order.payment_session_id !== "string" || !order.payment_session_id
        || order.order_currency !== "INR"
        || (expectedAmountPaise !== undefined && !amountMatches(order.order_amount, expectedAmountPaise))) {
      throw new PaymentProviderError("provider_rejected");
    }
    return { providerOrderId: input.providerOrderId, checkoutSession: order.payment_session_id };
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("provider_unavailable");
  }
}

/** Recover a timed-out Razorpay create call using BizBook's unique receipt. */
export async function recoverRazorpayOrder(input: {
  credentials: ProviderCredentials;
  localOrderId: string;
  amount: string;
  fetcher?: FetchLike;
}): Promise<ProviderOrderResult | null> {
  const amountPaise = rupeesToPaise(input.amount);
  if (!isProviderCredentialsValid("razorpay", input.credentials)
      || !/^[a-zA-Z0-9_-]{8,64}$/.test(input.localOrderId)
      || amountPaise === null || amountPaise <= 0
      || `bb_${input.localOrderId}`.length > 40) {
    throw new PaymentProviderError("credentials_unavailable");
  }
  const order = await fetchRazorpayOrder({ credentials: input.credentials,
    localOrderId: input.localOrderId, amountPaise, fetcher: input.fetcher ?? fetch });
  return order ? { providerOrderId: order.id, publicKey: input.credentials.key_id, providerStatus: order.status } : null;
}

/** Read all attempts for one Razorpay order for authenticated status reconciliation. */
export async function fetchRazorpayOrderPayments(input: {
  credentials: ProviderCredentials;
  providerOrderId: string;
  fetcher?: FetchLike;
}): Promise<ProviderPaymentState[]> {
  if (!isProviderCredentialsValid("razorpay", input.credentials)
      || !/^order_[a-zA-Z0-9]+$/.test(input.providerOrderId)) {
    throw new PaymentProviderError("credentials_unavailable");
  }
  const fetcher = input.fetcher ?? fetch;
  try {
    const response = await fetcher(`https://api.razorpay.com/v1/orders/${encodeURIComponent(input.providerOrderId)}/payments`, {
      method: "GET", headers: { ...authHeaders("razorpay", input.credentials), Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const value = await providerJson(response);
    if (!Array.isArray(value.items)) throw new PaymentProviderError("provider_unavailable");
    const payments = new Map<string, ProviderPaymentState>();
    for (const raw of value.items) {
      const payment = object(raw);
      if (!payment || payment.order_id !== input.providerOrderId || typeof payment.id !== "string"
          || typeof payment.amount !== "number" || !Number.isSafeInteger(payment.amount) || payment.amount <= 0
          || payment.currency !== "INR") continue;
      const status = payment.status === "captured" && payment.captured === true ? "captured"
        : payment.status === "authorized" ? "authorized"
          : payment.status === "failed" ? "failed"
            : payment.status === "created" ? "pending" : null;
      if (!status) continue;
      payments.set(payment.id, { providerOrderId: input.providerOrderId, providerPaymentId: payment.id,
        status, amount: paiseToRupees(payment.amount)!, currency: "INR" });
    }
    return [...payments.values()];
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("provider_unavailable");
  }
}

export async function fetchProviderPayment(input: {
  provider: PaymentProvider;
  credentials: ProviderCredentials;
  providerOrderId: string;
  providerPaymentId: string;
  fetcher?: FetchLike;
}): Promise<ProviderPaymentState> {
  if (!isProviderCredentialsValid(input.provider, input.credentials) || !input.providerPaymentId) {
    throw new PaymentProviderError("credentials_unavailable");
  }
  const fetcher = input.fetcher ?? fetch;
  const signal = AbortSignal.timeout(10_000);
  try {
    if (input.provider === "razorpay") {
      const response = await fetcher(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.providerPaymentId)}`, {
        method: "GET", headers: { ...authHeaders("razorpay", input.credentials), Accept: "application/json" },
        cache: "no-store", redirect: "error", signal,
      });
      const payment = await providerJson(response);
      if (payment.id !== input.providerPaymentId || payment.order_id !== input.providerOrderId
          || typeof payment.amount !== "number" || !Number.isSafeInteger(payment.amount)) {
        throw new PaymentProviderError("provider_rejected");
      }
      const status = payment.status === "captured" && payment.captured === true ? "captured"
        : payment.status === "authorized" ? "authorized"
          : payment.status === "failed" ? "failed" : "pending";
      return { providerOrderId: input.providerOrderId, providerPaymentId: input.providerPaymentId,
        status, amount: paiseToRupees(payment.amount)!, currency: typeof payment.currency === "string" ? payment.currency : "" };
    }

    const response = await fetcher(`https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(input.providerOrderId)}/payments`, {
      method: "GET", headers: { ...authHeaders("cashfree", input.credentials), Accept: "application/json" },
      cache: "no-store", redirect: "error", signal,
    });
    if (!response.ok) await providerJson(response);
    const value: unknown = await response.json().catch(() => null);
    const payments = Array.isArray(value) ? value : object(value) && Array.isArray((value as Record<string, unknown>).payments)
      ? (value as Record<string, unknown>).payments as unknown[] : null;
    const payment = payments?.map(object).find((row) => row?.cf_payment_id !== undefined
      && String(row.cf_payment_id) === input.providerPaymentId);
    if (!payment || String(payment.order_id ?? input.providerOrderId) !== input.providerOrderId) {
      throw new PaymentProviderError("provider_rejected");
    }
    const amount = typeof payment.payment_amount === "number" || typeof payment.payment_amount === "string"
      ? String(payment.payment_amount) : "";
    const statusValue = typeof payment.payment_status === "string" ? payment.payment_status : "";
    const status = statusValue === "SUCCESS" ? "captured"
      : statusValue === "FAILED" ? "failed"
        : statusValue === "USER_DROPPED" ? "cancelled" : "pending";
    if (!rupeesToPaise(amount)) throw new PaymentProviderError("provider_rejected");
    return { providerOrderId: input.providerOrderId, providerPaymentId: input.providerPaymentId,
      status, amount, currency: typeof payment.payment_currency === "string" ? payment.payment_currency : "INR" };
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("provider_unavailable");
  }
}

/**
 * Cashfree's hosted checkout callback does not prove payment and may not expose
 * a payment identifier. Fetch the provider's payment list for the server-created
 * order and let the caller process only a provider-reported state.
 */
export async function fetchCashfreeOrderPayments(input: {
  credentials: ProviderCredentials;
  providerOrderId: string;
  fetcher?: FetchLike;
}): Promise<ProviderOrderPaymentState> {
  if (!isProviderCredentialsValid("cashfree", input.credentials)) {
    throw new PaymentProviderError("credentials_unavailable");
  }
  const fetcher = input.fetcher ?? fetch;
  try {
    const response = await fetcher(
      `https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(input.providerOrderId)}/payments`,
      { method: "GET", headers: { ...authHeaders("cashfree", input.credentials), Accept: "application/json" },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) await providerJson(response);
    const value: unknown = await response.json().catch(() => null);
    const envelope = object(value);
    const payments = Array.isArray(value) ? value : envelope && Array.isArray(envelope.payments)
      ? envelope.payments : null;
    if (!payments) throw new PaymentProviderError("provider_unavailable");

    const states: ProviderPaymentState[] = [];
    for (const candidate of payments) {
      const payment = object(candidate);
      if (!payment || String(payment.order_id ?? input.providerOrderId) !== input.providerOrderId
          || payment.cf_payment_id === undefined || payment.cf_payment_id === null) continue;
      const rawAmount = typeof payment.payment_amount === "number" || typeof payment.payment_amount === "string"
        ? String(payment.payment_amount) : "";
      const amountPaise = rupeesToPaise(rawAmount);
      const rawStatus = typeof payment.payment_status === "string" ? payment.payment_status : "";
      if (amountPaise === null) continue;
      const status = rawStatus === "SUCCESS" ? "captured"
        : rawStatus === "FAILED" ? "failed"
          : rawStatus === "USER_DROPPED" ? "cancelled"
            : rawStatus === "PENDING" ? "pending" : null;
      if (!status) continue;
      states.push({ providerOrderId: input.providerOrderId, providerPaymentId: String(payment.cf_payment_id),
        status, amount: paiseToRupees(amountPaise)!,
        currency: typeof payment.payment_currency === "string" ? payment.payment_currency : "INR" });
    }
    return states;
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError("provider_unavailable");
  }
}
