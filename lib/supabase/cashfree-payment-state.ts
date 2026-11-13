import type { ProviderPaymentState } from "./online-payment-provider-core";

export type CashfreeOrderPaymentDecision =
  | { kind: "none" }
  | { kind: "reconcile" }
  | { kind: "payment"; payment: ProviderPaymentState };

/** Avoid auto-posting ambiguous orders with multiple successful Cashfree attempts. */
export function chooseCashfreeOrderPayment(
  payments: ProviderPaymentState[],
): CashfreeOrderPaymentDecision {
  const successful = payments.filter((payment) => payment.status === "captured");
  if (successful.length > 1) return { kind: "reconcile" };
  if (successful.length === 1) return { kind: "payment", payment: successful[0] };
  if (!payments.length) return { kind: "none" };
  const priority: ProviderPaymentState["status"][] = ["pending", "authorized", "failed", "cancelled", "captured"];
  const payment = [...payments].sort((left, right) => priority.indexOf(left.status) - priority.indexOf(right.status))[0];
  return { kind: "payment", payment };
}
