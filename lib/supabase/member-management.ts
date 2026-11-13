import type { WorkspaceInstitute } from "@/lib/supabase/workspace-scope";

export type ManagedInstituteRole = "owner" | "administrator" | "accountant" | "staff";
export type MemberAccessScope = "institute" | "branches";

export type ManagedMember = {
  user_id: string;
  email: string;
  role: ManagedInstituteRole;
  access_scope: MemberAccessScope;
  is_active: boolean;
};

export type MembershipActor = Pick<WorkspaceInstitute, "role" | "accessScope"> & { userId: string };

export const MEMBER_ROLE_DESCRIPTIONS: Record<ManagedInstituteRole, string> = {
  owner: "Full institute control, including membership and administrator roles.",
  administrator: "Manages day-to-day institute operations and standard members; cannot appoint owners or administrators.",
  accountant: "Handles finance records, receipts, refunds, expenses, and financial reports allowed by the institute policies.",
  staff: "Uses operational records allowed to staff; cannot manage institute members or roles.",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isExistingAuthUserId(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

export function isValidMemberEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Mirrors bizbook_private.can_manage_institute(). */
export function canManageInstituteMembers(
  institute: Pick<WorkspaceInstitute, "role" | "accessScope"> | null | undefined,
): boolean {
  return Boolean(
    institute && institute.accessScope === "institute" &&
      (institute.role === "owner" || institute.role === "administrator"),
  );
}

export function memberRoleOptions(actorRole: WorkspaceInstitute["role"]): ManagedInstituteRole[] {
  return actorRole === "owner"
    ? ["owner", "administrator", "accountant", "staff"]
    : ["accountant", "staff"];
}

export function canEditManagedMember(actor: MembershipActor, target: ManagedMember): boolean {
  if (!canManageInstituteMembers(actor) || target.user_id === actor.userId || !target.is_active) return false;
  return target.role !== "owner" || actor.role === "owner";
}

export function canDeactivateManagedMember(actor: MembershipActor, target: ManagedMember): boolean {
  return canEditManagedMember(actor, target);
}

/** May remove a different user's membership without deleting their Auth account. */
export function canRemoveManagedMember(actor: MembershipActor, target: ManagedMember): boolean {
  if (!canManageInstituteMembers(actor) || target.user_id === actor.userId) return false;
  return target.role !== "owner" && target.role !== "administrator" || actor.role === "owner";
}

export function canRestoreManagedMember(actor: MembershipActor, target: ManagedMember): boolean {
  if (!canManageInstituteMembers(actor) || target.user_id === actor.userId) return false;
  return target.role !== "owner" && target.role !== "administrator" || actor.role === "owner";
}

export function membershipScopeNote(scope: MemberAccessScope): string {
  return scope === "institute"
    ? "Can access institute-wide records allowed by their role."
    : "Can access assigned active branches only; assign at least one branch below.";
}
