import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import MemberManagementWorkspace from "@/components/members/MemberManagementWorkspace";

export default function MembersPage() {
  return (
    <WorkspaceLayout>
      <MemberManagementWorkspace />
    </WorkspaceLayout>
  );
}
