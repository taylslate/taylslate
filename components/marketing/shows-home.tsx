import Link from "next/link";
import { appBodyFont, appDisplayFont } from "@/lib/brand/app-fonts";
import { tokens } from "@/lib/brand/tokens";
import { LAUNCH } from "@/lib/marketing/launch-copy";
import { SHOWS_COPY } from "@/lib/marketing/shows-copy";
import { AudienceToggle } from "@/components/marketing/audience-toggle";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

const inkButton =
  "inline-flex items-center justify-center bg-[var(--ts-accent)] px-5 py-2.5 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90";
const quietLink =
  "text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]";

export function ShowsHome() {
  return (
    <MarketingChrome
      wide
      tone="ink-gold"
      className={`${appDisplayFont.variable} ${appBodyFont.variable}`}
      actions={
        <>
          <Link href="/" className={quietLink}>
            For brands
          </Link>
          <Link href={`/${LAUNCH.secondaryHref}`} className={quietLink}>
            {LAUNCH.pricingNav}
          </Link>
          <Link href={SHOWS_COPY.ctaHref} className={quietLink}>
            {LAUNCH.loginLabel}
          </Link>
          <Link
            href={SHOWS_COPY.ctaHref}
            className="hidden bg-[var(--ts-accent)] px-3.5 py-1.5 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 sm:inline-flex"
            style={{ borderRadius: tokens.radius }}
          >
            {SHOWS_COPY.cta}
          </Link>
        </>
      }
    >
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 pt-16 pb-16 sm:pt-20">
          <AudienceToggle guest="shows" />
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
            {SHOWS_COPY.eyebrow}
          </p>
          <h1 className="mt-4 max-w-4xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            {SHOWS_COPY.h1}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-[var(--ts-ink-muted-on-paper)] sm:text-lg">
            {SHOWS_COPY.sub}
          </p>
          <div className="mt-8">
            <Link
              href={SHOWS_COPY.ctaHref}
              className={inkButton}
              style={{ borderRadius: tokens.radius }}
            >
              {SHOWS_COPY.cta}
            </Link>
          </div>
        </section>

        <section className="border-t border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)]">
          <ol className="mx-auto grid max-w-6xl gap-4 px-6 py-16 sm:grid-cols-3 sm:py-20">
            {SHOWS_COPY.steps.map((step) => (
              <li
                key={step.n}
                className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-6"
                style={{ borderRadius: tokens.radius }}
              >
                <p className="text-[11px] font-medium tracking-[0.16em] text-[var(--ts-accent-text)]">
                  {step.n}
                </p>
                <h2 className="mt-2 text-lg font-semibold tracking-tight">{step.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </MarketingChrome>
  );
}
