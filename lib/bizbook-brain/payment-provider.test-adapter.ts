/** Test-only deterministic provider. Never import this from application code. */

import { fromPaise, toPaise } from "./money";
import {
  validateProviderOrderInput,
  validateProviderVerificationInput,
} from "./payment-provider";
import type {
  CreateProviderOrderInput,
  PaymentProvider,
  ProviderOrder,
  ProviderVerificationInput,
  ProviderVerificationResult,
} from "./payment-provider";

function safeAmount(amount: number): number {
  return fromPaise(toPaise(amount));
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "Mock";

  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    validateProviderOrderInput(input);

    return {
      provider: this.name,
      orderId: `mock_order_${input.paymentId.trim()}`,
      paymentId: input.paymentId.trim(),
      amount: safeAmount(input.amount),
      currency: input.currency ?? "INR",
      status: "SIMULATED",
      createdAt: new Date().toISOString(),
    };
  }

  async verifyPayment(
    input: ProviderVerificationInput,
  ): Promise<ProviderVerificationResult> {
    validateProviderVerificationInput(input);

    return {
      verified: false,
      provider: this.name,
      orderId: input.orderId.trim(),
      paymentId: input.paymentId.trim(),
      providerPaymentId: input.providerPaymentId.trim(),
      amount: safeAmount(input.amount),
      currency: input.currency,
      message: "Mock provider cannot verify real payments.",
    };
  }
}
