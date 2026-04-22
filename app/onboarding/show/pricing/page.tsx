import { redirect } from "next/navigation";
import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import PricingForm from "./pricing-form";

export default async function PricingPage() {
  const user = await getAuthenticatedUser();
  const profile = user ? await getShowProfileByUserId(user.id) : null;

  // We need audience_size to calibrate the benchmark. Send them back if missing.
  if (!profile || profile.audience_size == null) {
    redirect("/onboarding/show/audience");
  }

  return (
    <PricingForm
      audienceSize={profile.audience_size}
      initialValue={profile.expected_cpm ?? null}
    />
  );
}
