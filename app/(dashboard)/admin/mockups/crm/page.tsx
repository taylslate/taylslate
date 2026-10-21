import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { CrmClient } from "./crm-client";

export default async function CrmMockupPage() {
  await requireMockupAdmin();
  return <CrmClient />;
}
