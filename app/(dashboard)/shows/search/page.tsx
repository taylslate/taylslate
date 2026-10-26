import { redirect } from "next/navigation";
import { getAuthenticatedUser, getEffectiveRole } from "@/lib/data/queries";
import { isBrandSide } from "@/lib/nav/items";
import ShowSearchClient from "./search-client";

export default async function ShowSearchPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const eff = await getEffectiveRole(user.id);
  if (!eff) redirect("/onboarding");
  if (!isBrandSide(eff.effectiveRole)) redirect("/dashboard");

  return <ShowSearchClient />;
}
