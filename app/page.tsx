import type { Metadata } from "next";
import { HomeLanding } from "@/components/marketing/home-landing";
import { GUEST_COPY, parseGuest } from "@/lib/marketing/guest";

type HomeParams = {
  searchParams: Promise<{ for?: string | string[] }>;
};

export async function generateMetadata({
  searchParams,
}: HomeParams): Promise<Metadata> {
  const copy = GUEST_COPY[parseGuest((await searchParams).for)];
  return {
    title: `Taylslate — ${copy.h1.replace(/\.$/, "")}`,
    description: copy.sub,
  };
}

export default async function Home({ searchParams }: HomeParams) {
  const guest = parseGuest((await searchParams).for);
  return <HomeLanding initialGuest={guest} />;
}
