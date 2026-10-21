import type { Metadata } from "next";
import { LaunchHome } from "@/components/marketing/launch-home";
import { publicMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = publicMetadata("/");

export default function Home() {
  return <LaunchHome />;
}
