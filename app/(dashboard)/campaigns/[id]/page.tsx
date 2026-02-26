import { campaigns } from "@/lib/data";
import { notFound } from "next/navigation";
import CampaignDetail from "./campaign-detail";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = campaigns.find((c) => c.id === id);
  if (!campaign) notFound();

  return <CampaignDetail campaign={campaign} />;
}
