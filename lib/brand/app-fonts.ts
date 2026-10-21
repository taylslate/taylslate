import { Figtree, Fraunces } from "next/font/google";

export const appDisplayFont = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-app-display",
});

export const appBodyFont = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-app-sans",
});
