import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { MockupIndex } from "./index-view";

export default async function MockupsIndexPage() {
  await requireMockupAdmin();
  return <MockupIndex />;
}
