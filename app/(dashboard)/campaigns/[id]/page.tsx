import { getCampaignById } from "@/lib/data/queries";
import { notFound } from "next/navigation";
import CampaignDetail from "./campaign-detail";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign) notFound();

  return <CampaignDetail campaign={campaign} />;
}
