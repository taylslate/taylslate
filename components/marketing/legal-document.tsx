import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

export const LEGAL_DRAFT_BANNER =
  "Draft for review. Not yet legal advice or an agreed contract.";

const bodyLinkClass = "underline text-[var(--ts-ink-on-paper)]";

export function LegalDocument({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <MarketingChrome>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <p className="text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
          {LEGAL_DRAFT_BANNER}
        </p>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-6 space-y-8 text-sm leading-relaxed text-[var(--ts-ink-on-paper)]">
          {children}
        </div>
      </main>
    </MarketingChrome>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function DataUseCopy({ consentLine }: { consentLine: string }) {
  return (
    <>
      <p>{consentLine}</p>
      <p className="font-semibold">How the product applies that line</p>
      <p>
        Anonymized patterns from deals booked and transacted through Taylslate
        feed a pooled dataset.
      </p>
      <p>
        An uploaded past-campaign file joins that pool only if the brand opts
        in on the import screen. The checkbox is off by default. The terms
        version recorded is pooling-v1.
      </p>
      <p>
        A brand&apos;s own uploaded past-campaign file stays private to that
        brand. It is not shown to other brands or shows. That file is never
        part of any aggregate unless that brand opted in. An imported
        insertion-order PDF becomes an ordinary deal and is pooled once it is
        signed.
      </p>
    </>
  );
}

export function LegalBodyLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={bodyLinkClass}>
      {children}
    </Link>
  );
}
