import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { PaymentProvider } from "./payment-connection-validation";
import {
  isProviderCredentialsValid,
  PaymentProviderError,
  type ProviderCredentials,
} from "./online-payment-provider-core";
import { isSandboxCheckedPlatformPaymentConnection } from "./platform-subscription-payment-core";

/** Resolve only Vault credentials whose sandbox check was recorded by a real provider response. */
export async function loadSandboxCheckedPlatformPaymentCredentials(
  client: SupabaseClient<Database>,
  provider: PaymentProvider,
): Promise<ProviderCredentials> {
  const { data: metadata, error: metadataError } = await client
    .from("platform_provider_connections")
    .select("provider_scope, provider, environment, connection_status, last_verified_at")
    .eq("provider_scope", "payment")
    .eq("provider", provider)
    .maybeSingle();
  if (metadataError || !isSandboxCheckedPlatformPaymentConnection(metadata)) {
    throw new PaymentProviderError("credentials_unavailable");
  }

  const { data, error } = await client.rpc("get_platform_provider_credentials", {
    p_provider_scope: "payment",
    p_provider: provider,
    p_allow_pending: true,
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
