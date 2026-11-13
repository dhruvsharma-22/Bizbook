import assert from "node:assert/strict";
import { isAccessibleWorkspaceBranchSelection, type WorkspaceBranch, type WorkspaceInstitute } from "./workspace-scope";

const branches: WorkspaceBranch[] = [{ id: "branch-a", name: "North" }, { id: "branch-b", name: "South" }];
const instituteAccess: Pick<WorkspaceInstitute, "accessScope"> = { accessScope: "institute" };
const assignedAccess: Pick<WorkspaceInstitute, "accessScope"> = { accessScope: "branches" };

assert.equal(isAccessibleWorkspaceBranchSelection(instituteAccess, branches, ""), true, "institute-wide access may select all accessible branches");
assert.equal(isAccessibleWorkspaceBranchSelection(assignedAccess, branches, ""), false, "branch-scoped access cannot select all branches");
assert.equal(isAccessibleWorkspaceBranchSelection(instituteAccess, branches, "branch-a"), true, "an RLS-visible branch can be selected");
assert.equal(isAccessibleWorkspaceBranchSelection(assignedAccess, branches, "branch-b"), true, "an assigned branch can be selected");
assert.equal(isAccessibleWorkspaceBranchSelection(instituteAccess, branches, "other-institute-branch"), false, "a branch absent from authorized results is rejected");
assert.equal(isAccessibleWorkspaceBranchSelection(assignedAccess, [], "branch-a"), false, "a stale or revoked branch selection is rejected");

console.log("Workspace branch preference tests: 6 assertions passed.");
