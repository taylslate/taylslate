import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { RosterClient } from "./roster-client";

export default async function RepRosterMockupPage() {
  await requireMockupAdmin();
  return <RosterClient />;
}
