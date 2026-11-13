import "server-only";

import { createSupabaseServerClient } from "./server";

export type InstituteRole = "owner" | "administrator" | "accountant" | "staff";
export type InstituteAccessScope = "institute" | "branches";

export class PlatformAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 | 503,
  ) {
    super(message);
    this.name = "PlatformAuthorizationError";
  }
}

export class SupabaseAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "SupabaseAuthorizationError";
  }
}

/** Resolves platform authority from the signed-in user and an RLS-protected database function. */
export type PlatformAdministratorRole = "owner" | "operator" | "support";

export async function requirePlatformAdministrator(): Promise<{ userId: string; role: PlatformAdministratorRole }> {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new PlatformAuthorizationError("Authentication is required.", 401);
  }

  const { data: role, error } = await supabase.rpc("get_platform_admin_role");
  if (error) {
    throw new PlatformAuthorizationError("Platform administrator verification is unavailable.", 503);
  }
  if (role !== "owner" && role !== "operator" && role !== "support") {
    throw new PlatformAuthorizationError("Platform administrator access is not allowed.", 403);
  }
  return { userId: authData.user.id, role };
}

/**
 * Resolve the user from the verified Supabase session, then check their membership
 * through the RLS-protected membership table. Never accept a caller-supplied user ID or role.
 */
export async function requireInstituteAccess(
  instituteId: string,
  options: {
    allowedRoles?: readonly InstituteRole[];
    branchId?: string;
  } = {},
): Promise<{
  userId: string;
  role: InstituteRole;
  accessScope: InstituteAccessScope;
  branchId?: string;
}> {
  if (!instituteId.trim()) {
    throw new SupabaseAuthorizationError("Institute access is required.", 403);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new SupabaseAuthorizationError("Authentication is required.", 401);
  }

  const { data: institute, error: instituteError } = await supabase
    .from("coaching_institutes")
    .select("account_status")
    .eq("id", instituteId)
    .maybeSingle();
  if (instituteError) {
    throw new Error("Could not verify institute status.");
  }
  if (!institute || institute.account_status !== "active") {
    throw new SupabaseAuthorizationError("Institute access is not allowed.", 403);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("user_memberships")
    .select("role, access_scope")
    .eq("institute_id", instituteId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipError) {
    throw new Error("Could not verify institute membership.");
  }
  if (!membership) {
    throw new SupabaseAuthorizationError("Institute access is not allowed.", 403);
  }

  if (options.allowedRoles && !options.allowedRoles.includes(membership.role)) {
    throw new SupabaseAuthorizationError("This role cannot perform the requested action.", 403);
  }

  if (options.branchId) {
    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .select("id")
      .eq("institute_id", instituteId)
      .eq("id", options.branchId)
      .eq("is_active", true)
      .maybeSingle();

    if (branchError) {
      throw new Error("Could not verify branch access.");
    }
    if (!branch) {
      throw new SupabaseAuthorizationError("Branch access is not allowed.", 403);
    }
  }

  if (membership.access_scope === "branches") {
    if (!options.branchId?.trim()) {
      throw new SupabaseAuthorizationError("A permitted branch is required.", 403);
    }

    const { data: branchAccess, error: branchError } = await supabase
      .from("membership_branch_access")
      .select("branch_id")
      .eq("institute_id", instituteId)
      .eq("user_id", user.id)
      .eq("branch_id", options.branchId)
      .maybeSingle();

    if (branchError) {
      throw new Error("Could not verify branch access.");
    }
    if (!branchAccess) {
      throw new SupabaseAuthorizationError("Branch access is not allowed.", 403);
    }
  }

  return {
    userId: user.id,
    role: membership.role,
    accessScope: membership.access_scope,
    ...(options.branchId ? { branchId: options.branchId } : {}),
  };
}

