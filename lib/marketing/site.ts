import type { Metadata } from "next";

export const SITE_ORIGIN = "https://www.taylslate.com";

export type PublicPage = {
  path: string;
  title: string;
  description: string;
  /** Indexed launch page. Full Open Graph tags and a sitemap entry. */
  marketing: boolean;
  /** File that exports this page's metadata. Must be a Server Component. */
  metadataFile: string;
  /** Route page module. Marketing pages must not be client components. */
  pageFile: string;
};

export const PUBLIC_PAGES: readonly PublicPage[] = [
  {
    path: "/",
    title: "Make 2027 the year you win with podcast ads | Taylslate",
    description:
      "Find shows worth testing, score the fit, build the media plan, and pay the host when the read runs.",
    marketing: true,
    metadataFile: "app/page.tsx",
    pageFile: "app/page.tsx",
  },
  {
    path: "/for-shows",
    title: "Get the brief, the IO, and paid when the episode runs. | Taylslate",
    description:
      "A brand reaches out with a real offer. You review terms, countersign, deliver, and the payout follows the charge.",
    marketing: true,
    metadataFile: "app/for-shows/page.tsx",
    pageFile: "app/for-shows/page.tsx",
  },
  {
    path: "/login",
    title: "Log in | Taylslate",
    description: "Log in to Taylslate.",
    marketing: false,
    metadataFile: "app/(auth)/login/layout.tsx",
    pageFile: "app/(auth)/login/page.tsx",
  },
  {
    path: "/signup",
    title: "Create an account | Taylslate",
    description: "Create a Taylslate account to start a podcast campaign.",
    marketing: false,
    metadataFile: "app/(auth)/signup/layout.tsx",
    pageFile: "app/(auth)/signup/page.tsx",
  },
  {
    path: "/forgot-password",
    title: "Reset password | Taylslate",
    description: "Request a link to reset your Taylslate password.",
    marketing: false,
    metadataFile: "app/(auth)/forgot-password/layout.tsx",
    pageFile: "app/(auth)/forgot-password/page.tsx",
  },
  {
    path: "/reset-password",
    title: "Choose a new password | Taylslate",
    description: "Set a new password for your Taylslate account.",
    marketing: false,
    metadataFile: "app/(auth)/reset-password/page.tsx",
    pageFile: "app/(auth)/reset-password/page.tsx",
  },
  {
    path: "/auth/magic",
    title: "Check your link | Taylslate",
    description: "Magic link status for a Taylslate show invite.",
    marketing: false,
    metadataFile: "app/auth/magic/layout.tsx",
    pageFile: "app/auth/magic/page.tsx",
  },
];

export function marketingPages(): readonly PublicPage[] {
  return PUBLIC_PAGES.filter((page) => page.marketing);
}

export function absoluteUrl(path: string): string {
  if (path === "/") return SITE_ORIGIN;
  return `${SITE_ORIGIN}${path}`;
}

export function publicMetadata(path: string): Metadata {
  const page = PUBLIC_PAGES.find((entry) => entry.path === path);
  if (!page) {
    throw new Error(`Unknown public page: ${path}`);
  }
  const url = absoluteUrl(page.path);
  const metadata: Metadata = {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    robots: page.marketing
      ? { index: true, follow: true }
      : { index: false, follow: true },
  };
  if (page.marketing) {
    metadata.openGraph = {
      title: page.title,
      description: page.description,
      url,
      siteName: "Taylslate",
      type: "website",
      locale: "en_US",
    };
    metadata.twitter = {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
    };
  }
  return metadata;
}
