import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";

const RESERVING_STATUSES = new Set(["Pending", "Processing", "Completed"]);

export type RefundReservation = { amount: number | string; status: string };
export type RefundAllocationSource = { id: string; amount: number | string };
export type RefundReceiptKind = "Fee" | "Advance";
export type RefundPaymentMode = "Manual" | "Online";
export type RefundReceiptFilter = "all" | "manual-fee" | "manual-advance" | "online";

export function matchesRefundReceiptFilter(
  receipt: { receipt_kind: RefundReceiptKind; mode: RefundPaymentMode },
  filter: RefundReceiptFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "online") return receipt.mode === "Online";
  if (filter === "manual-fee") return receipt.mode === "Manual" && receipt.receipt_kind === "Fee";
  return receipt.mode === "Manual" && receipt.receipt_kind === "Advance";
}

export type ManualRefundPlan = {
  amount: number;
  refundableAmount: number;
  reason: string;
  allocationBreakdown: Array<{ payment_allocation_id: string; amount: number }>;
};

function parsePaise(value: number | string, field: string): number {
  const parsed = parseAmountInputToPaise(typeof value === "number" ? String(value) : value);
  if (parsed === null) throw new Error(`${field} has invalid monetary precision.`);
  return parsed;
}

function addPaise(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("Refund totals exceed safe paise precision.");
  return result;
}

export function getRefundableReceiptPaise(
  paymentAmount: number | string,
  refunds: readonly RefundReservation[],
): number {
  const receiptPaise = parsePaise(paymentAmount, "Receipt amount");
  if (receiptPaise <= 0) throw new Error("Receipt amount must be positive.");
  let reservedPaise = 0;
  for (const refund of refunds) {
    if (!RESERVING_STATUSES.has(refund.status)) continue;
    const amountPaise = parsePaise(refund.amount, "Reserved refund amount");
    if (amountPaise <= 0) throw new Error("Reserved refund amount must be positive.");
    reservedPaise = addPaise(reservedPaise, amountPaise);
  }
  return Math.max(0, receiptPaise - reservedPaise);
}

export function prepareManualRefundPlan(input: {
  amount: number;
  paymentAmount: number | string;
  reason: string;
  refunds: readonly RefundReservation[];
  allocations: readonly RefundAllocationSource[];
  reservedByAllocationId: ReadonlyMap<string, number | string>;
}): ManualRefundPlan {
  const requestPaise = parseAmountInputToPaise(String(input.amount));
  if (requestPaise === null || requestPaise <= 0) {
    throw new Error("Enter a positive refund amount with no more than two decimal places.");
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) {
    throw new Error("Enter a refund reason of 1 to 500 characters.");
  }

  const refundablePaise = getRefundableReceiptPaise(input.paymentAmount, input.refunds);
  if (requestPaise > refundablePaise) {
    throw new Error("Refund exceeds the remaining refundable receipt balance.");
  }

  let remainingPaise = requestPaise;
  const allocationBreakdown: ManualRefundPlan["allocationBreakdown"] = [];
  let allocationTotalPaise = 0;
  for (const allocation of input.allocations) {
    if (!allocation.id) continue;
    const amountPaise = parsePaise(allocation.amount, "Payment allocation amount");
    if (amountPaise <= 0) throw new Error("Payment allocation amount must be positive.");
    allocationTotalPaise = addPaise(allocationTotalPaise, amountPaise);
    const alreadyReserved = parsePaise(input.reservedByAllocationId.get(allocation.id) ?? 0, "Reserved allocation refund amount");
    if (alreadyReserved < 0) throw new Error("Reserved allocation refund amount cannot be negative.");
    const available = Math.max(0, amountPaise - alreadyReserved);
    const allocateNow = Math.min(remainingPaise, available);
    if (allocateNow > 0) {
      allocationBreakdown.push({ payment_allocation_id: allocation.id, amount: allocateNow / 100 });
      remainingPaise -= allocateNow;
    }
  }

  if (allocationTotalPaise > parsePaise(input.paymentAmount, "Receipt amount")) {
    throw new Error("Payment allocations exceed the original receipt amount.");
  }

  const reservedRefundPaise = input.refunds
    .filter((refund) => RESERVING_STATUSES.has(refund.status))
    .reduce((sum, refund) => addPaise(sum, parsePaise(refund.amount, "Reserved refund amount")), 0);
  const reservedAllocationPaise = [...input.reservedByAllocationId.values()]
    .reduce<number>((sum, value) => addPaise(sum, parsePaise(value, "Reserved allocation refund amount")), 0);
  const previouslyReservedUnallocated = Math.max(0, reservedRefundPaise - reservedAllocationPaise);
  const availableUnallocatedPaise = Math.max(
    0,
    parsePaise(input.paymentAmount, "Receipt amount") - allocationTotalPaise - previouslyReservedUnallocated,
  );
  if (remainingPaise > availableUnallocatedPaise) {
    throw new Error("Refund exceeds the available unallocated receipt balance.");
  }

  // The RPC independently ensures any unallocated portion fits the receipt's
  // free balance after outstanding refund reservations.
  return {
    amount: requestPaise / 100,
    refundableAmount: refundablePaise / 100,
    reason,
    allocationBreakdown,
  };
}
