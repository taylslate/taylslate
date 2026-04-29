import { redirect } from "next/navigation";
import { getAuthenticatedUser, getEffectiveRole } from "@/lib/data/queries";
import { isRouteAllowedForRole } from "@/lib/nav/items";
import ShowsClient from "./shows-client";

export default async function ShowsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const eff = await getEffectiveRole(user.id);
  if (!eff) redirect("/onboarding");
  if (!isRouteAllowedForRole("/shows", eff.effectiveRole)) {
    redirect("/dashboard");
  }

  return <ShowsClient />;
}
