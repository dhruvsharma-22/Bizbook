export type PaymentHistoryRefund = {
  id: string;
  payment_id: string;
  amount: number | string;
  status: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled";
  mode: "Manual" | "Online";
  provider_refund_reference: string | null;
  created_at: string;
};

export type PaymentRefundSummary = {
  refunds: PaymentHistoryRefund[];
  completedAmount: number;
  pendingAmount: number;
};

/** Summarizes refund rows without treating pending work as a completed return. */
export function summarizePaymentRefunds(
  refunds: readonly PaymentHistoryRefund[],
): Map<string, PaymentRefundSummary> {
  const summaries = new Map<string, PaymentRefundSummary>();

  for (const refund of refunds) {
    const amountPaise = parseAmountInputToPaise(String(refund.amount));
    if (amountPaise === null || amountPaise <= 0) continue;

    const summary = summaries.get(refund.payment_id) ?? {
      refunds: [],
      completedAmount: 0,
      pendingAmount: 0,
    };
    summary.refunds.push(refund);
    if (refund.status === "Completed") {
      const total = parseAmountInputToPaise(String(summary.completedAmount));
      if (total === null || !Number.isSafeInteger(total + amountPaise)) {
        summary.refunds.pop();
        continue;
      }
      summary.completedAmount = (total + amountPaise) / 100;
    }
    if (refund.status === "Pending" || refund.status === "Processing") {
      const total = parseAmountInputToPaise(String(summary.pendingAmount));
      if (total === null || !Number.isSafeInteger(total + amountPaise)) {
        summary.refunds.pop();
        continue;
      }
      summary.pendingAmount = (total + amountPaise) / 100;
    }
    summaries.set(refund.payment_id, summary);
  }

  return summaries;
}
import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";
