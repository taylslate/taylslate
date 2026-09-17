export type MarketingGuest = "brands" | "shows";

export function parseGuest(
  value: string | string[] | null | undefined,
): MarketingGuest {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "shows" ? "shows" : "brands";
}

export function guestHref(guest: MarketingGuest): string {
  return guest === "shows" ? "/?for=shows" : "/";
}

export const GUEST_COPY = {
  brands: {
    eyebrow: "For brands",
    h1: "Run creator sponsorships without an agency.",
    sub: "Tell us what you sell and who buys it. We find a small set of shows worth testing — then handle the IO, the signature, and paying the host.",
    cta: "Get started",
    ctaHref: "/signup",
    steps: [
      {
        n: "01",
        title: "Interpret the brief",
        body: "You describe the product and the customer. We send back who the campaign is actually for. You confirm that before we look at shows.",
      },
      {
        n: "02",
        title: "Build the test portfolio",
        body: "A short list of podcasts and YouTube shows you can actually try. First buy is a few spots, not a forty-show plan.",
      },
      {
        n: "03",
        title: "Close and pay",
        body: "Outreach, insertion order, and signatures in one thread. Card on file. The show is paid when the episode delivers.",
      },
    ],
  },
  shows: {
    eyebrow: "For shows",
    h1: "Get the brief, the IO, and paid when the episode runs.",
    sub: "A brand reaches out with a real offer. You review terms, countersign, deliver, and the payout follows the charge.",
    cta: "Get started",
    // Shows onboard via magic-link outreach, not password self-signup.
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
  },
} as const;
