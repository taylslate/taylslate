import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { RosterUploadClient } from "./upload-client";

export default async function RosterUploadMockupPage() {
  await requireMockupAdmin();
  return <RosterUploadClient />;
}
