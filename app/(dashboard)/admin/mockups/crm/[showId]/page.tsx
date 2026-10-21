import { notFound } from "next/navigation";
import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { getCrmShow } from "@/app/(dashboard)/admin/mockups/fixtures";
import { CrmShowClient } from "./show-client";

export default async function CrmShowMockupPage({
  params,
}: {
  params: Promise<{ showId: string }>;
}) {
  await requireMockupAdmin();
  const { showId } = await params;
  if (!getCrmShow(showId)) notFound();
  return <CrmShowClient showId={showId} />;
}
