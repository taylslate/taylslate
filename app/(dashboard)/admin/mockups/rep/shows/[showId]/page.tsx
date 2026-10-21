import { notFound } from "next/navigation";
import { requireMockupAdmin } from "@/app/(dashboard)/admin/mockups/require-admin";
import { getRosterShow } from "@/app/(dashboard)/admin/mockups/fixtures";
import { RepShowClient } from "./show-client";

export default async function RepShowMockupPage({
  params,
}: {
  params: Promise<{ showId: string }>;
}) {
  await requireMockupAdmin();
  const { showId } = await params;
  if (!getRosterShow(showId)) notFound();
  return <RepShowClient showId={showId} />;
}
