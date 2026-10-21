import type { Metadata } from "next";
import "./globals.css";
import "@/lib/brand/tokens.css";
import { SITE_ORIGIN } from "@/lib/marketing/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: "Taylslate",
  description:
    "Tell us the product and who buys it. We interpret the brief, build a test portfolio, write the insertion order, and pay the show when the read runs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}