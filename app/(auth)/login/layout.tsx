import type { Metadata } from "next";
import { publicMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = publicMetadata("/login");

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
