import type { Metadata } from "next";
import { publicMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = publicMetadata("/auth/magic");

export default function MagicLinkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
