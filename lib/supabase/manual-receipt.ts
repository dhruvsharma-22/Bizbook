import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";

export type ManualReceiptKind = "Fee" | "Advance";
export type ReceiptAllocationTarget = { installmentId: string; outstandingAmount: number };

export type ManualReceiptPlan = {
  allocations: Array<{ installment_id: string; amount: number }>;
  unallocatedAmount: number;
};

function paise(value: number, field: string, invalidMessage?: string): number {
  const parsed = Number.isFinite(value) ? parseAmountInputToPaise(String(value)) : null;
  if (parsed === null) throw new Error(invalidMessage ?? `${field} must be a valid amount to the nearest paise.`);
  return parsed;
}

export function prepareManualReceiptPlan(
  kind: ManualReceiptKind,
  amount: number,
  target?: ReceiptAllocationTarget,
): ManualReceiptPlan {
  const receivedPaise = paise(
    amount,
    "Receipt amount",
    "Enter a positive amount with no more than two decimal places.",
  );
  if (receivedPaise <= 0) {
    throw new Error("Enter a positive amount with no more than two decimal places.");
  }
  if (kind === "Fee" && !target) {
    throw new Error("Choose an installment for a fee receipt. Use an advance receipt for unallocated funds.");
  }
  if (!target) return { allocations: [], unallocatedAmount: receivedPaise / 100 };
  if (!target.installmentId || !Number.isFinite(target.outstandingAmount)) {
    throw new Error("The selected installment has no outstanding balance.");
  }
  const remainingPaise = paise(target.outstandingAmount, "Installment balance");
  if (remainingPaise <= 0) throw new Error("The selected installment has no outstanding balance.");
  if (kind === "Fee" && receivedPaise > remainingPaise) {
    throw new Error("A fee receipt cannot exceed the selected installment balance.");
  }
  const allocatedPaise = Math.min(receivedPaise, remainingPaise);
  return {
    allocations: [{ installment_id: target.installmentId, amount: allocatedPaise / 100 }],
    unallocatedAmount: (receivedPaise - allocatedPaise) / 100,
  };
}
