
/**
 * BizBook Brain — Money Utilities
 *
 * Handles monetary calculations consistently.
 * This file does not save payments or change student records.
 */

import { BizBookError } from "./errors";

const MAX_SUPPORTED_AMOUNT_PAISE = 999_999_999_999;

/**
 * Parse an amount from a form/API decimal string without floating-point rounding.
 * Returns null for unsupported precision, negative values, malformed input, or
 * values that do not fit the database's numeric(12,2) amount columns.
 */
export function parseAmountInputToPaise(value: string): number | null {
  const input = value.trim();
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(input)) return null;

  const [wholeText = "0", fractionText = ""] = input.split(".");
  const whole = Number(wholeText || "0");
  if (!Number.isSafeInteger(whole) || whole > 9_999_999_999) return null;
  const paise = whole * 100 + Number(fractionText.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(paise) || paise > MAX_SUPPORTED_AMOUNT_PAISE) return null;

  return paise;
}

/**
 * Convert rupees into integer paise.
 * Example: ₹150.50 -> 15050 paise
 */
export function toPaise(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Amount must be a valid non-negative number.",
      { amount }
    );
  }

  const scaledAmount = (amount + Number.EPSILON) * 100;
  const paise = Math.round(scaledAmount);

  // Allow only floating-point representation noise around exact paise values.
  if (Math.abs(scaledAmount - paise) > 0.000001) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Amount cannot include fractions of a paise.",
      { amount }
    );
  }

  if (!Number.isSafeInteger(paise)) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Amount is too large to calculate safely.",
      { amount }
    );
  }

  return paise;
}

/**
 * Convert integer paise into rupees.
 * Example: 15050 paise -> ₹150.50
 */
export function fromPaise(paise: number): number {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Paise must be a non-negative safe integer.",
      { paise }
    );
  }

  return paise / 100;
}

/**
 * Add multiple amounts safely.
 */
export function addMoney(...amounts: number[]): number {
  const totalPaise = amounts.reduce((total, amount) => {
    const nextTotal = total + toPaise(amount);

    if (!Number.isSafeInteger(nextTotal)) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Total amount is too large to calculate safely."
      );
    }

    return nextTotal;
  }, 0);

  return fromPaise(totalPaise);
}

/**
 * Subtract one amount from another.
 * Rejects deductions greater than the available amount.
 */
export function subtractMoney(
  amount: number,
  deduction: number
): number {
  const remainingPaise = toPaise(amount) - toPaise(deduction);

  if (remainingPaise < 0) {
    throw new BizBookError(
      "INSUFFICIENT_BALANCE",
      "Deduction cannot exceed the available amount.",
      { amount, deduction }
    );
  }

  return fromPaise(remainingPaise);
}

/**
 * Calculate outstanding fees.
 *
 * Extra payments are not silently discarded.
 * Handle any excess separately as advance.
 */
export function calculateOutstanding(
  totalFee: number,
  totalReceived: number
): number {
  const feePaise = toPaise(totalFee);
  const receivedPaise = toPaise(totalReceived);

  if (receivedPaise > feePaise) {
    throw new BizBookError(
      "INSUFFICIENT_BALANCE",
      "Received amount exceeds the total fee. Handle the extra amount as advance separately.",
      { totalFee, totalReceived }
    );
  }

  return fromPaise(feePaise - receivedPaise);
}

/**
 * Format an amount using Indian currency notation.
 * Example: ₹1,25,000.00
 */
export function formatINR(amount: number): string {
  toPaise(amount);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
