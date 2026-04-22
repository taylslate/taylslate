// Shared step metadata for the show/creator onboarding flow (Wave 9).
// Mirrors app/onboarding/brand/steps.ts.

export const SHOW_ONBOARDING_STEPS = [
  { slug: "welcome", label: "Welcome" },
  { slug: "confirm", label: "Confirm show" },
  { slug: "platform", label: "Platform" },
  { slug: "cadence", label: "Cadence" },
  { slug: "audience", label: "Audience" },
  { slug: "pricing", label: "Pricing" },
  { slug: "formats", label: "Ad formats" },
  { slug: "read-types", label: "Ad reads" },
  { slug: "placements", label: "Placements" },
  { slug: "exclusions", label: "Exclusions" },
  { slug: "summary", label: "Review" },
] as const;

export type ShowOnboardingSlug = (typeof SHOW_ONBOARDING_STEPS)[number]["slug"];

export const TOTAL_STEPS = SHOW_ONBOARDING_STEPS.length;

export function stepIndexOf(slug: ShowOnboardingSlug): number {
  return SHOW_ONBOARDING_STEPS.findIndex((s) => s.slug === slug);
}

export function nextStepSlug(slug: ShowOnboardingSlug): ShowOnboardingSlug | null {
  const idx = stepIndexOf(slug);
  if (idx === -1 || idx === SHOW_ONBOARDING_STEPS.length - 1) return null;
  return SHOW_ONBOARDING_STEPS[idx + 1].slug;
}

export function prevStepSlug(slug: ShowOnboardingSlug): ShowOnboardingSlug | null {
  const idx = stepIndexOf(slug);
  if (idx <= 0) return null;
  return SHOW_ONBOARDING_STEPS[idx - 1].slug;
}
