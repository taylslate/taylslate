import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { ImportClient } from "./import-client";

export default async function ImportMockupPage() {
  await requireMockupAdmin();
  return <ImportClient />;
}
