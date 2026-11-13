import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { PaymentProvider } from "./payment-connection-validation";
import {
  isProviderCredentialsValid,
  PaymentProviderError,
  type ProviderCredentials,
} from "./online-payment-provider-core";

export {
  createProviderRefund,
  createProviderOrder,
  fetchCashfreeOrderPayments,
  fetchRazorpayOrderPayments,
  fetchProviderRefund,
  fetchProviderPayment,
  PaymentProviderError,
  recoverRazorpayOrder,
  retrieveProviderCheckout,
  type ProviderCredentials,
  type ProviderOrderResult,
  type ProviderOrderPaymentState,
  type ProviderPaymentState,
  type ProviderRefundState,
  type ProviderRefundStatus,
} from "./online-payment-provider-core";

export async function loadActiveInstitutePaymentCredentials(
  client: SupabaseClient<Database>,
  instituteId: string,
  provider: PaymentProvider,
): Promise<ProviderCredentials> {
  const { data, error } = await client.rpc("get_payment_connection_credentials", {
    p_institute_id: instituteId,
    p_provider: provider,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new PaymentProviderError("credentials_unavailable");
  }
  const value = data as Record<string, unknown>;
  const credentials: ProviderCredentials = {
    key_id: typeof value.key_id === "string" ? value.key_id : undefined,
    key_secret: typeof value.key_secret === "string" ? value.key_secret : undefined,
    client_id: typeof value.client_id === "string" ? value.client_id : undefined,
    client_secret: typeof value.client_secret === "string" ? value.client_secret : undefined,
    webhook_secret: typeof value.webhook_secret === "string" ? value.webhook_secret : undefined,
  };
  if (!isProviderCredentialsValid(provider, credentials)) throw new PaymentProviderError("credentials_unavailable");
  return credentials;
}
