import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";

function toPaise(amount: number): number | null {
  return parseAmountInputToPaise(String(amount));
}

export type AdvanceAllocation = {
  amount: number;
  remainingAdvance: number;
  remainingInstallment: number;
};

/** Validate an allocation using balances from the canonical database views. */
export function prepareAdvanceAllocation(
  amount: number,
  availableAdvance: number,
  installmentOutstanding: number,
): AdvanceAllocation {
  const amountPaise = toPaise(amount);
  if (amountPaise === null || amountPaise <= 0) {
    throw new Error("Enter a positive amount with no more than two decimal places.");
  }
  if (!Number.isFinite(availableAdvance) || availableAdvance <= 0) {
    throw new Error("This advance receipt has no amount available to allocate.");
  }
  if (!Number.isFinite(installmentOutstanding) || installmentOutstanding <= 0) {
    throw new Error("The selected installment has no outstanding balance.");
  }

  const availablePaise = toPaise(availableAdvance);
  const outstandingPaise = toPaise(installmentOutstanding);
  if (availablePaise === null || outstandingPaise === null) {
    throw new Error("Stored advance or installment balance has invalid monetary precision.");
  }
  if (amountPaise > availablePaise) {
    throw new Error("Allocation exceeds the available advance balance.");
  }
  if (amountPaise > outstandingPaise) {
    throw new Error("Allocation exceeds the installment outstanding balance.");
  }

  return {
    amount: amountPaise / 100,
    remainingAdvance: (availablePaise - amountPaise) / 100,
    remainingInstallment: (outstandingPaise - amountPaise) / 100,
  };
}
