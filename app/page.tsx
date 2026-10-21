import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { LaunchHome } from "@/components/marketing/launch-home";
import { showsLandingPath } from "@/lib/marketing/launch-copy";
import { publicMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = publicMetadata("/");

type HomeParams = {
  searchParams: Promise<{ for?: string | string[] }>;
};

export default async function Home({ searchParams }: HomeParams) {
  const target = showsLandingPath((await searchParams).for);
  if (target) permanentRedirect(target);
  return <LaunchHome />;
}
