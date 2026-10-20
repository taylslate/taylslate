import { Figtree, Fraunces } from "next/font/google";

export const displayFont = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-preview-display",
});

export const bodyFont = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-preview-sans",
});
