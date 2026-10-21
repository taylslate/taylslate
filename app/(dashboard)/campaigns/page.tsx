import { redirect } from "next/navigation";
import { getAuthenticatedUser, getCampaignsForUser, getEffectiveRole } from "@/lib/data/queries";
import { isRouteAllowedForRole } from "@/lib/nav/items";
import CampaignsClient from "./campaigns-client";

export default async function CampaignsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const [eff, campaigns] = await Promise.all([
    getEffectiveRole(user.id),
    getCampaignsForUser(user.id),
  ]);
  if (!eff) redirect("/onboarding");
  if (!isRouteAllowedForRole("/campaigns", eff.effectiveRole)) {
    redirect("/dashboard");
  }

  return <CampaignsClient initialCampaigns={campaigns} />;
}
