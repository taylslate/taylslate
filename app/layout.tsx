import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taylslate — AI-Powered Media Planning",
  description: "Plan podcast and YouTube sponsorship campaigns in minutes, not weeks.",
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