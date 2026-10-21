import type { Metadata } from "next";
import { ShowsHome } from "@/components/marketing/shows-home";
import { publicMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = publicMetadata("/for-shows");

export default function ForShowsPage() {
  return <ShowsHome />;
}
