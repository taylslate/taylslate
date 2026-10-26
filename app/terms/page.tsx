import type { Metadata } from "next";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

const CONSENT_LINE =
  "Taylslate may use aggregated, anonymized data from deals booked and completed through Taylslate to improve pricing and recommendations. Aggregates never identify a brand, and each one combines at least five brands. Files you upload stay private unless you choose to share them.";

export const metadata: Metadata = {
  title: "Terms of service",
  description: CONSENT_LINE,
};

export default function TermsPage() {
  return (
    <MarketingChrome>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Terms of service</h1>
        <p className="mt-6 text-sm leading-relaxed text-[var(--ts-ink-on-paper)]">
          {CONSENT_LINE}
        </p>
      </main>
    </MarketingChrome>
  );
}
