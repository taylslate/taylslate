import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsMockupPage() {
  await requireMockupAdmin();
  return <ApprovalsClient />;
}
