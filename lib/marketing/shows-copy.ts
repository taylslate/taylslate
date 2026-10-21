import type { MarketingGuest } from "@/lib/marketing/guest";

/** Public shows page. /shows stays the logged-in roster. */
export const SHOWS_PAGE_PATH = "/for-shows";

export function audiencePath(guest: MarketingGuest): "/" | typeof SHOWS_PAGE_PATH {
  return guest === "shows" ? SHOWS_PAGE_PATH : "/";
}

/**
 * Shows side of the homepage toggle, verbatim from 83c44c4
 * (components removed in c7887e4 / #12).
 */
export const SHOWS_COPY = {
  eyebrow: "For shows",
  h1: "Get the brief, the IO, and paid when the episode runs.",
  sub: "A brand reaches out with a real offer. You review terms, countersign, deliver, and the payout follows the charge.",
  cta: "Get started",
  ctaHref: "/login",
  steps: [
    {
      n: "01",
      title: "Review the offer",
      body: "See the brand, the terms, and the flight before you agree.",
    },
    {
      n: "02",
      title: "Sign the IO",
      body: "Countersign in place. Same document the brand signed.",
    },
    {
      n: "03",
      title: "Paid on delivery",
      body: "When the episode is marked delivered, the charge runs and the payout follows.",
    },
  ],
} as const;
