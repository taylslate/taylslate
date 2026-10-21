import type { Metadata } from "next";
import { publicMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = publicMetadata("/signup");

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
