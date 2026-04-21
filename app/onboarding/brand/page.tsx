import { redirect } from "next/navigation";
import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import type { BrandOnboardingSlug } from "./steps";

/**
 * Landing the user on /onboarding/brand routes them to the first unanswered
 * question. That makes "leave and come back" behave like a natural resume.
 */
export default async function BrandOnboardingIndex() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/onboarding/brand/welcome");

  const profile = await getBrandProfileByUserId(user.id);

  if (profile?.onboarded_at) {
    redirect("/dashboard");
  }

  const nextStep: BrandOnboardingSlug = (() => {
    if (!profile) return "welcome";
    if (!profile.brand_identity) return "identity";
    if (profile.brand_website == null) return "website";
    if (!profile.target_customer) return "customer";
    if (profile.target_age_min == null) return "age";
    if (!profile.target_gender) return "gender";
    if (!profile.content_categories || profile.content_categories.length === 0) return "categories";
    if (!profile.campaign_goal) return "goals";
    if (profile.exclusions == null) return "exclusions";
    return "summary";
  })();

  redirect(`/onboarding/brand/${nextStep}`);
}
