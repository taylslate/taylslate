import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { RepDealsClient } from "./deals-client";

export default async function RepDealsMockupPage() {
  await requireMockupAdmin();
  return <RepDealsClient />;
}
