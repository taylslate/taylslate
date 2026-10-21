import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { RosterRequestsClient } from "./roster-requests-client";

export default async function RosterRequestsMockupPage() {
  await requireMockupAdmin();
  return <RosterRequestsClient />;
}
