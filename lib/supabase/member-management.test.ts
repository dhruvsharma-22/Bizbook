import {
  canDeactivateManagedMember,
  canEditManagedMember,
  canManageInstituteMembers,
  canRestoreManagedMember,
  isExistingAuthUserId,
  isValidMemberEmail,
  MEMBER_ROLE_DESCRIPTIONS,
  memberRoleOptions,
  membershipScopeNote,
} from "./member-management";

const owner = { userId: "11111111-1111-4111-8111-111111111111", role: "owner" as const, accessScope: "institute" as const };
const admin = { userId: "22222222-2222-4222-8222-222222222222", role: "administrator" as const, accessScope: "institute" as const };
const branchAdmin = { ...admin, accessScope: "branches" as const };
const staffMember = { user_id: "33333333-3333-4333-8333-333333333333", email: "staff@example.com", role: "staff" as const, access_scope: "branches" as const, is_active: true };
const ownerMember = { ...staffMember, role: "owner" as const };

const checks: Array<[string, () => boolean]> = [
  ["accepts a valid Supabase Auth UUID", () => isExistingAuthUserId("33333333-3333-4333-8333-333333333333")],
  ["trims UUID input before validating", () => isExistingAuthUserId(" 33333333-3333-4333-8333-333333333333 ")],
  ["rejects a malformed UUID", () => !isExistingAuthUserId("not-a-user-id")],
  ["accepts a trimmed member email", () => isValidMemberEmail("  person@example.com  ")],
  ["rejects a malformed member email", () => !isValidMemberEmail("person-at-example.com")],
  ["rejects email values over the Auth address limit", () => !isValidMemberEmail(`${"a".repeat(250)}@example.com`)],
  ["institute owner can manage members", () => canManageInstituteMembers(owner)],
  ["institute administrator can manage members", () => canManageInstituteMembers(admin)],
  ["branch-scoped administrator cannot manage institute membership", () => !canManageInstituteMembers(branchAdmin)],
  ["administrator cannot grant owner or administrator role", () => memberRoleOptions("administrator").join(",") === "accountant,staff"],
  ["owner can grant all institute roles", () => memberRoleOptions("owner").length === 4],
  ["owner role guide explains full institute control", () => MEMBER_ROLE_DESCRIPTIONS.owner.includes("Full institute control")],
  ["administrator role guide explains elevated-role limits", () => MEMBER_ROLE_DESCRIPTIONS.administrator.includes("cannot appoint owners")],
  ["accountant role guide describes finance responsibilities", () => MEMBER_ROLE_DESCRIPTIONS.accountant.includes("finance records")],
  ["staff role guide excludes member management", () => MEMBER_ROLE_DESCRIPTIONS.staff.includes("cannot manage institute members")],
  ["manager can edit another active staff membership", () => canEditManagedMember(owner, staffMember)],
  ["manager cannot edit their own membership", () => !canEditManagedMember(owner, { ...staffMember, user_id: owner.userId })],
  ["administrator cannot edit an owner membership", () => !canEditManagedMember(admin, ownerMember)],
  ["inactive memberships cannot be changed through active-row actions", () => !canDeactivateManagedMember(owner, { ...staffMember, is_active: false })],
  ["owner can reactivate an inactive member", () => canRestoreManagedMember(owner, { ...staffMember, is_active: false })],
  ["administrator cannot reactivate an owner membership", () => !canRestoreManagedMember(admin, { ...ownerMember, is_active: false })],
  ["administrator can reactivate an inactive staff membership", () => canRestoreManagedMember(admin, { ...staffMember, is_active: false })],
  ["members cannot reactivate their own membership", () => !canRestoreManagedMember(owner, { ...staffMember, user_id: owner.userId, is_active: false })],
  ["branch-scoped access explains that branches must be assigned", () => membershipScopeNote("branches").includes("assign at least one branch")],
];

let failed = 0;
for (const [name, check] of checks) {
  if (check()) console.log(`PASS: ${name}`);
  else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}
console.log(`Member management: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exitCode = 1;
