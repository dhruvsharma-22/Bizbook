import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());
const expectedHost = "xabfsqtevwnwtxxkmkvc.supabase.co";
const targetUserId = process.env.PLATFORM_ADMIN_USER_ID?.trim();

async function main() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!rawUrl || new URL(rawUrl).hostname !== expectedHost) {
    throw new Error("Refusing to provision: this script is restricted to the authorized test project.");
  }
  if (!targetUserId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
    throw new Error("Set PLATFORM_ADMIN_USER_ID to the separately verified Supabase Auth user UUID.");
  }

  const supabase = createClient(rawUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
  const { data, error: userError } = await supabase.auth.admin.getUserById(targetUserId);
  if (userError) {
  throw new Error(
    `Supabase Auth lookup failed: ${userError.message} (status: ${userError.status ?? "unknown"})`
  );
}

if (!data.user) {
  throw new Error("No Auth user was returned for the supplied ID.");
}
  const { error } = await supabase.rpc("provision_first_platform_owner", { p_user_id: data.user.id });
  if (error) {
    throw new Error("First-owner provisioning was rejected. Confirm that no platform administrator already exists.");
  }
  process.stdout.write("First platform owner provisioned in the authorized test project.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Provisioning failed."}\n`);
  process.exitCode = 1;
});
