import { redirect } from "next/navigation";
import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import SummaryClient from "./summary-client";

export default async function SummaryPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/onboarding/brand/welcome");

  const profile = await getBrandProfileByUserId(user.id);
  // If the user hasn't started onboarding yet, send them to the beginning.
  if (!profile) redirect("/onboarding/brand/welcome");

  return <SummaryClient profile={profile} />;
}
