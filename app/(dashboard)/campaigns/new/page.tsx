import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import NewCampaignForm from "./new-campaign-form";

export default async function NewCampaignPage() {
  const user = await getAuthenticatedUser();
  const profile = user ? await getBrandProfileByUserId(user.id) : null;

  return <NewCampaignForm profile={profile} />;
}
