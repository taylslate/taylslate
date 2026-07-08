import type { ReactNode } from "react";

export interface OnboardingRole {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
}

// Self-serve signup role options shown in the post-signup role picker.
//
// "show" / creator is intentionally NOT offered here: shows onboard via the
// magic-link+OTP outreach path (a brand's outreach email → /api/auth/magic),
// not password self-signup. Offering it here would mint password-based show
// accounts that contradict the shows-are-magic-link-OTP auth model.
export const ONBOARDING_ROLES: OnboardingRole[] = [
  {
    id: "brand",
    title: "Brand / Advertiser",
    description:
      "I'm an advertiser looking to run creator sponsorship campaigns",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    id: "agency",
    title: "Agency",
    description: "I manage campaigns for multiple brand clients",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: "agent",
    title: "Agent / Talent Manager",
    description: "I represent shows and manage their ad inventory",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
    ),
  },
];
