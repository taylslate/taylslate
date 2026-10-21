// January 2027 launch copy. Display only.
// Do not import billing plans or fee math. The in-app fee schedule is unchanged.

export const LAUNCH = {
  eyebrow: "January 2027",
  headline: "Make 2027 the year you win with podcast ads.",
  sub: "Tell us the product and who buys it. Taylslate scores the shows, builds the media plan, and pays the host when the read runs.",
  primaryCta: "Start free",
  primaryHref: "/signup",
  secondaryCta: "See pricing",
  secondaryHref: "#pricing",
  loginLabel: "Log in",
  loginHref: "/login",
  pricingNav: "Pricing",
  facts: [
    {
      title: "Discovery",
      body: "A scored list of shows for this product and this buyer.",
    },
    {
      title: "Media plan",
      body: "Spots, flight dates, and price before you send an offer.",
    },
    {
      title: "Payment",
      body: "The show is paid when the episode runs.",
    },
  ],
  proof: {
    id: "proof",
    heading: "Proof",
    sub: "Placeholders. Logos, quotes, and results appear here only after a brand agrees to be named. Nothing below is a customer claim.",
    items: [
      {
        label: "Placeholder",
        title: "Brand logo",
        body: "A logo goes here after a brand agrees to be named.",
      },
      {
        label: "Placeholder",
        title: "Customer quote",
        body: "A quote from a brand operator goes here. None is approved yet.",
      },
      {
        label: "Placeholder",
        title: "Result",
        body: "A result the brand is willing to share goes here. No number is published yet.",
      },
    ],
  },
  pricing: {
    id: "pricing",
    heading: "Pricing",
    sub: "Launch pricing for January 2027. The brand pays the platform fee on top of each deal. Shows are free.",
    feeLabel: "Platform fee",
    showsNote:
      "Shows do not pay a subscription or a platform fee. Log in when a brand sends an offer.",
    showsCta: "Show log in",
    showsHref: "/login",
    plans: [
      {
        id: "free",
        name: "Free",
        price: "$0",
        cadence: null,
        features: [
          "Discovery, scoring, and media plans",
          "1 active campaign",
        ],
        cardFee: "10% card",
        bankFee: "7% bank",
        cta: "Start free",
        href: "/signup",
      },
      {
        id: "starter",
        name: "Starter",
        price: "$79",
        cadence: "/mo",
        features: ["5 active campaigns", "CRM"],
        cardFee: "8% card",
        bankFee: "5% bank",
        cta: "Get started",
        href: "/signup",
      },
      {
        id: "operator",
        name: "Operator",
        price: "$299",
        cadence: "/mo",
        features: ["Unlimited campaigns", "Full CRM"],
        cardFee: "6% card",
        bankFee: "3% bank",
        cta: "Get started",
        href: "/signup",
      },
    ],
  },
  close: {
    heading: "Open an account for 2027.",
    body: "Discovery, scoring, and a media plan are included. The free plan covers one active campaign.",
    cta: "Start free",
    href: "/signup",
  },
  product: {
    id: "product",
    windowTitle: "Sample dashboard",
    caption:
      "Static mock of the brand dashboard. Show names, scores, and prices are sample data, not a live campaign.",
    campaignKicker: "Sample campaign",
    campaignTitle: "Winter test",
    budgetLabel: "Test budget",
    budget: "$24,000",
    portfolio: "Test portfolio",
    portfolioMeta: "3 shows",
    portfolioNote: "Fits a 3-spot test.",
    audienceLabel: "Audience fit",
    audienceValue: "Unmeasured",
    topicalLabel: "Topical",
    purchaseLabel: "Purchase power",
    priceLabel: "3 spots",
    nav: ["Dashboard", "Campaigns", "Deals", "Invoices", "Settings"],
    activeNav: "Campaigns",
    newCampaign: "New campaign",
    shows: [
      {
        name: "North Kitchen",
        initials: "NK",
        band: "Medium",
        topical: 72,
        purchase: 64,
        price: "$1,800",
      },
      {
        name: "Long Commute",
        initials: "LC",
        band: "Medium",
        topical: 68,
        purchase: 61,
        price: "$2,400",
      },
      {
        name: "Desk Notes",
        initials: "DN",
        band: "Medium",
        topical: 64,
        purchase: 70,
        price: "$1,200",
      },
    ],
  },
} as const;

export function planFee(cardFee: string, bankFee: string): string {
  return `${cardFee} / ${bankFee}`;
}
