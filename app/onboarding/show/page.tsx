import { redirect } from "next/navigation";
import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import type { ShowOnboardingSlug } from "./steps";

/**
 * Landing on /onboarding/show resumes to the first unanswered question so
 * the show/creator can leave and come back without losing their place.
 */
export default async function ShowOnboardingIndex() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/onboarding/show/welcome");

  const profile = await getShowProfileByUserId(user.id);

  if (profile?.onboarded_at) {
    redirect("/dashboard");
  }

  const nextStep: ShowOnboardingSlug = (() => {
    if (!profile) return "welcome";
    if (profile.feed_url == null) return "welcome";
    if (!profile.show_name) return "confirm";
    if (!profile.platform) return "platform";
    if (!profile.episode_cadence) return "cadence";
    if (profile.audience_size == null) return "audience";
    if (profile.expected_cpm == null) return "pricing";
    if (!profile.ad_formats || profile.ad_formats.length === 0) return "formats";
    if (!profile.ad_read_types || profile.ad_read_types.length === 0) return "read-types";
    if (!profile.placements || profile.placements.length === 0) return "placements";
    if (!profile.category_exclusions || profile.category_exclusions.length === 0) return "exclusions";
    return "summary";
  })();

  redirect(`/onboarding/show/${nextStep}`);
}
