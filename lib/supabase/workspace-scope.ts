import type { createSupabaseBrowserClient } from "./client";

export const TEST_PROJECT_REF = "xabfsqtevwnwtxxkmkvc";

export type WorkspaceInstitute = {
  id: string;
  name: string;
  timeZone: string;
  role: "owner" | "administrator" | "accountant" | "staff";
  accessScope: "institute" | "branches";
};

export type WorkspaceBranch = { id: string; name: string };
export type WorkspaceScopePreference = { instituteId: string; branchId: string };

/** A saved selection is a convenience only; callers must validate it against live access. */
export function parseWorkspaceScopePreference(value: unknown): WorkspaceScopePreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.instituteId !== "string" || !record.instituteId.trim() || record.instituteId.length > 100) return null;
  if (typeof record.branchId !== "string" || record.branchId.length > 100) return null;
  return { instituteId: record.instituteId, branchId: record.branchId };
}

/** Revalidates a saved preference and falls back to the first currently authorized scope. */
export function resolveWorkspaceScopeSelection(
  institutes: readonly WorkspaceInstitute[],
  branches: readonly WorkspaceBranch[],
  preference: WorkspaceScopePreference | null,
): WorkspaceScopePreference | null {
  if (!institutes.length) return null;
  const institute = institutes.find((item) => item.id === preference?.instituteId) ?? institutes[0];
  if (!institute) return null;
  const preferredBranch = preference?.instituteId === institute.id ? preference.branchId : "";
  // Institute-wide memberships now open the entire institute workspace by
  // default; saved branch filters from the retired branch switcher are ignored.
  // Legacy branch-scoped memberships remain pinned to an authorized branch.
  const branchId = institute.accessScope === "branches"
    ? isAccessibleWorkspaceBranchSelection(institute, branches, preferredBranch) && preferredBranch
      ? preferredBranch
      : branches[0]?.id ?? ""
    : "";
  return { instituteId: institute.id, branchId };
}

/** Validates a branch preference against the membership and RLS-filtered branch list. */
export function isAccessibleWorkspaceBranchSelection(
  institute: Pick<WorkspaceInstitute, "accessScope">,
  accessibleBranches: readonly WorkspaceBranch[],
  branchId: string,
): boolean {
  if (!branchId) return institute.accessScope === "institute";
  return accessibleBranches.some((branch) => branch.id === branchId);
}

type BrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

export function isAuthorizedTestProjectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === `${TEST_PROJECT_REF}.supabase.co`
      && !url.port
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function isAuthorizedTestProjectConfigured(): boolean {
  return isAuthorizedTestProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}

export async function loadWorkspaceInstitutes(
  supabase: BrowserClient,
): Promise<WorkspaceInstitute[]> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error("Your account could not be verified.");
  if (!auth.user) return [];

  const { data: memberships, error: membershipError } = await supabase
    .from("user_memberships")
    .select("institute_id, role, access_scope")
    .eq("user_id", auth.user.id)
    .eq("is_active", true);
  if (membershipError) throw new Error("Your institute access could not be loaded.");
  if (!memberships?.length) return [];

  const instituteIds = [...new Set(memberships.map((membership) => membership.institute_id))];
  const { data: institutes, error: instituteError } = await supabase
    .from("coaching_institutes")
    .select("id, business_name, time_zone")
    .in("id", instituteIds)
    .order("business_name");
  if (instituteError) throw new Error("Institute details could not be loaded.");

  const byId = new Map((institutes ?? []).map((institute) => [institute.id, institute]));
  return memberships.flatMap((membership) => {
    const institute = byId.get(membership.institute_id);
    return institute ? [{
      id: institute.id,
      name: institute.business_name,
      timeZone: institute.time_zone,
      role: membership.role,
      accessScope: membership.access_scope,
    }] : [];
  });
}

export async function loadWorkspaceBranches(
  supabase: BrowserClient,
  instituteId: string,
): Promise<WorkspaceBranch[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, name")
    .eq("institute_id", instituteId)
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error("Accessible branches could not be loaded.");
  return data ?? [];
}

export async function loadWorkspaceScopePreference(
  supabase: BrowserClient,
  userId: string,
): Promise<WorkspaceScopePreference | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("workspace_preferences")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("Your saved workspace selection could not be loaded.");
  if (!data) return null;
  const preferences = data.workspace_preferences;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return null;
  return parseWorkspaceScopePreference(preferences);
}

export async function saveWorkspaceScopePreference(
  supabase: BrowserClient,
  userId: string,
  preference: WorkspaceScopePreference,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ workspace_preferences: preference })
    .eq("id", userId);
  if (error) throw new Error("Your workspace selection could not be saved.");
}
