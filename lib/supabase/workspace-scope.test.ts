import assert from "node:assert/strict";
import {
  TEST_PROJECT_REF,
  isAuthorizedTestProjectUrl,
  parseWorkspaceScopePreference,
  resolveWorkspaceScopeSelection,
  type WorkspaceInstitute,
  type WorkspaceBranch,
} from "./workspace-scope";

const safeTestUrl = `https://${TEST_PROJECT_REF}.supabase.co`;

assert.equal(isAuthorizedTestProjectUrl(safeTestUrl), true, "the exact authorized HTTPS project host is accepted");
assert.equal(isAuthorizedTestProjectUrl(`http://${TEST_PROJECT_REF}.supabase.co`), false, "plain HTTP is rejected");
assert.equal(isAuthorizedTestProjectUrl(`https://${TEST_PROJECT_REF}.supabase.co.attacker.example`), false, "a host with the project name as a prefix is rejected");
assert.equal(isAuthorizedTestProjectUrl(`https://${TEST_PROJECT_REF}.attacker.example`), false, "a spoofed project subdomain is rejected");
assert.equal(isAuthorizedTestProjectUrl("https://cjuneqmohdivjioulyqq.supabase.co"), false, "the production project is rejected");
assert.equal(isAuthorizedTestProjectUrl(`${safeTestUrl}:8443`), false, "unexpected ports are rejected");
assert.equal(isAuthorizedTestProjectUrl(`https://user:password@${TEST_PROJECT_REF}.supabase.co`), false, "URLs containing credentials are rejected");
assert.equal(isAuthorizedTestProjectUrl("not-a-url"), false, "malformed URLs are rejected");

console.log("Workspace project guard tests: 8 assertions passed.");

const institutes: WorkspaceInstitute[] = [
  { id: "institute-a", name: "A", timeZone: "Asia/Kolkata", role: "owner", accessScope: "institute" },
  { id: "institute-b", name: "B", timeZone: "Asia/Kolkata", role: "staff", accessScope: "branches" },
];
const branches: WorkspaceBranch[] = [{ id: "branch-b1", name: "B1" }, { id: "branch-b2", name: "B2" }];

assert.deepEqual(parseWorkspaceScopePreference({ instituteId: "institute-b", branchId: "branch-b2" }), { instituteId: "institute-b", branchId: "branch-b2" });
assert.equal(parseWorkspaceScopePreference(null), null);
assert.equal(parseWorkspaceScopePreference({ instituteId: "", branchId: "" }), null);
assert.equal(parseWorkspaceScopePreference({ instituteId: "institute-a", branchId: 4 }), null);
assert.deepEqual(
  resolveWorkspaceScopeSelection(institutes, branches, { instituteId: "institute-b", branchId: "branch-b2" }),
  { instituteId: "institute-b", branchId: "branch-b2" },
);
assert.deepEqual(
  resolveWorkspaceScopeSelection(institutes, branches, { instituteId: "institute-b", branchId: "unauthorized-branch" }),
  { instituteId: "institute-b", branchId: "branch-b1" },
);
assert.deepEqual(
  resolveWorkspaceScopeSelection(institutes, branches, { instituteId: "revoked-institute", branchId: "branch-b2" }),
  { instituteId: "institute-a", branchId: "" },
);
assert.deepEqual(
  resolveWorkspaceScopeSelection(institutes, branches, { instituteId: "institute-a", branchId: "branch-b1" }),
  { instituteId: "institute-a", branchId: "" },
  "institute-wide members do not inherit a stale branch filter",
);
assert.equal(resolveWorkspaceScopeSelection([], branches, null), null);

console.log("Workspace profile preference tests: 8 assertions passed.");
