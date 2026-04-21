// Shared step metadata for the brand onboarding flow.
// Keep this file small and side-effect-free so both server layouts and
// client components can import it.

export const BRAND_ONBOARDING_STEPS = [
  { slug: "welcome", label: "Welcome" },
  { slug: "identity", label: "Brand identity" },
  { slug: "website", label: "Website" },
  { slug: "customer", label: "Target customer" },
  { slug: "age", label: "Age range" },
  { slug: "gender", label: "Gender" },
  { slug: "categories", label: "Categories" },
  { slug: "goals", label: "Goals" },
  { slug: "exclusions", label: "Exclusions" },
  { slug: "summary", label: "Review" },
] as const;

export type BrandOnboardingSlug = (typeof BRAND_ONBOARDING_STEPS)[number]["slug"];

export const TOTAL_STEPS = BRAND_ONBOARDING_STEPS.length;

export function stepIndexOf(slug: BrandOnboardingSlug): number {
  return BRAND_ONBOARDING_STEPS.findIndex((s) => s.slug === slug);
}

export function nextStepSlug(slug: BrandOnboardingSlug): BrandOnboardingSlug | null {
  const idx = stepIndexOf(slug);
  if (idx === -1 || idx === BRAND_ONBOARDING_STEPS.length - 1) return null;
  return BRAND_ONBOARDING_STEPS[idx + 1].slug;
}

export function prevStepSlug(slug: BrandOnboardingSlug): BrandOnboardingSlug | null {
  const idx = stepIndexOf(slug);
  if (idx <= 0) return null;
  return BRAND_ONBOARDING_STEPS[idx - 1].slug;
}
