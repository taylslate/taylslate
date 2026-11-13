import type { Metadata } from "next";
import { publicMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = publicMetadata("/signup/show");

export default function ShowSignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
