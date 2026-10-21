import { redirect } from "next/navigation";
import {
  getAllShows,
  getAuthenticatedUser,
  getEffectiveRole,
  getShowsFiltered,
  getUserProfile,
} from "@/lib/data/queries";
import { isRouteAllowedForRole } from "@/lib/nav/items";
import ShowsClient from "./shows-client";

export default async function ShowsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const [eff, profile] = await Promise.all([
    getEffectiveRole(user.id),
    getUserProfile(user.id),
  ]);
  if (!eff) redirect("/onboarding");
  if (!isRouteAllowedForRole("/shows", eff.effectiveRole)) {
    redirect("/dashboard");
  }

  const shows =
    profile?.role === "agent"
      ? await getShowsFiltered({ agent_id: user.id })
      : await getAllShows();

  return <ShowsClient initialShows={shows} />;
}
