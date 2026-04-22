import { redirect } from "next/navigation";
import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import BrandProfileForm from "./brand-profile-form";

export default async function BrandProfileSettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/settings/brand-profile");

  const profile = await getBrandProfileByUserId(user.id);
  return <BrandProfileForm profile={profile} />;
}
