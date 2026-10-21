import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { ApiKeysClient } from "./api-keys-client";

export default async function ApiKeysMockupPage() {
  await requireMockupAdmin();
  return <ApiKeysClient />;
}
