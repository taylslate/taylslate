import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import { buildBriefFromProfile } from "@/lib/utils/brand-brief";
import NewCampaignForm from "./new-campaign-form";

export default async function NewCampaignPage() {
  const user = await getAuthenticatedUser();
  const profile = user ? await getBrandProfileByUserId(user.id) : null;

  return (
    <NewCampaignForm
      initialBrandUrl={profile?.brand_website ?? ""}
      initialBriefText={buildBriefFromProfile(profile)}
    />
  );
}
