import { redirect } from "next/navigation";
import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import SummaryClient from "./summary-client";

export default async function ShowSummaryPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/onboarding/show/summary");

  const profile = await getShowProfileByUserId(user.id);
  if (!profile) {
    redirect("/onboarding/show/welcome");
  }

  return <SummaryClient profile={profile} />;
}
