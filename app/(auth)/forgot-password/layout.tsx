import type { Metadata } from "next";
import { publicMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = publicMetadata("/forgot-password");

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
