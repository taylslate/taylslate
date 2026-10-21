import Link from "next/link";
import { appBodyFont, appDisplayFont } from "@/lib/brand/app-fonts";
import { tokens } from "@/lib/brand/tokens";
import { LAUNCH, planFee, realProofItems } from "@/lib/marketing/launch-copy";
import { AudienceToggle } from "@/components/marketing/audience-toggle";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { ProductShot } from "@/components/marketing/product-shot";

const inkButton =
  "inline-flex items-center justify-center bg-[var(--ts-accent)] px-5 py-2.5 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90";
const quietLink =
  "text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]";

function PrimaryLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`${inkButton} ${className}`}
      style={{ borderRadius: tokens.radius }}
    >
      {children}
    </Link>
  );
}

export function ProofSection({
  proof,
}: {
  proof: {
    id: string;
    heading: string;
    sub: string;
    items: readonly { label: string; title: string; body: string }[];
  };
}) {
  const items = realProofItems(proof.items);
  if (items.length === 0) return null;
  return (
    <section
      id={proof.id}
      className="border-t border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)]"
      aria-labelledby="proof-heading"
    >
      <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <h2 id="proof-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {proof.heading}
        </h2>
        <ul className="mt-10 grid gap-4 sm:grid-cols-3">
          {items.map((item) => (
            <li
              key={item.title}
              className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5"
              style={{ borderRadius: tokens.radius }}
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
                {item.label}
              </p>
              <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function LaunchHome() {
  return (
    <MarketingChrome
      wide
      tone="ink-gold"
      className={`${appDisplayFont.variable} ${appBodyFont.variable}`}
      actions={
        <>
          <Link href={LAUNCH.showsNavHref} className={quietLink}>
            {LAUNCH.showsNav}
          </Link>
          <Link href={LAUNCH.secondaryHref} className={quietLink}>
            {LAUNCH.pricingNav}
          </Link>
          <Link href={LAUNCH.loginHref} className={quietLink}>
            {LAUNCH.loginLabel}
          </Link>
          <Link
            href={LAUNCH.primaryHref}
            className="hidden bg-[var(--ts-accent)] px-3.5 py-1.5 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 sm:inline-flex"
            style={{ borderRadius: tokens.radius }}
          >
            {LAUNCH.primaryCta}
          </Link>
        </>
      }
    >
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 pt-16 pb-16 sm:pt-20">
          <AudienceToggle />
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
            {LAUNCH.eyebrow}
          </p>
          <h1 className="mt-4 max-w-4xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            {LAUNCH.headline}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-[var(--ts-ink-muted-on-paper)] sm:text-lg">
            {LAUNCH.sub}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <PrimaryLink href={LAUNCH.primaryHref}>{LAUNCH.primaryCta}</PrimaryLink>
            <Link
              href={LAUNCH.secondaryHref}
              className="inline-flex items-center justify-center border border-[var(--ts-ink-on-paper)]/20 px-5 py-2.5 text-sm font-medium hover:bg-[var(--ts-band-shows)]"
              style={{ borderRadius: tokens.radius }}
            >
              {LAUNCH.secondaryCta}
            </Link>
          </div>

          <dl className="mt-12 grid gap-8 border-t border-[var(--ts-hairline-on-paper)] pt-8 sm:grid-cols-3">
            {LAUNCH.facts.map((fact) => (
              <div key={fact.title}>
                <dt className="text-sm font-semibold">{fact.title}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
                  {fact.body}
                </dd>
              </div>
            ))}
          </dl>

          <ProductShot />
        </section>

        <ProofSection proof={LAUNCH.proof} />

        <section
          id={LAUNCH.pricing.id}
          className="scroll-mt-16 border-t border-[var(--ts-hairline-on-paper)]"
          aria-labelledby="pricing-heading"
        >
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <h2 id="pricing-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {LAUNCH.pricing.heading}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)] sm:text-base">
              {LAUNCH.pricing.sub}
            </p>
            <ul className="mt-10 grid gap-4 lg:grid-cols-3">
              {LAUNCH.pricing.plans.map((plan) => (
                <li
                  key={plan.id}
                  className="flex flex-col border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-6"
                  style={{ borderRadius: tokens.radius }}
                >
                  <h3 className="text-base font-semibold">{plan.name}</h3>
                  <p className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tracking-tight">
                      {plan.price}
                    </span>
                    {plan.cadence ? (
                      <span className="text-sm text-[var(--ts-ink-muted-on-paper)]">
                        {plan.cadence}
                      </span>
                    ) : null}
                  </p>
                  <ul className="mt-6 space-y-2 text-sm">
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ts-ink-muted-on-paper)]">
                    {LAUNCH.pricing.feeLabel}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {planFee(plan.cardFee, plan.bankFee)}
                  </p>
                  <div className="mt-8">
                    <PrimaryLink href={plan.href} className="w-full">
                      {plan.cta}
                    </PrimaryLink>
                  </div>
                </li>
              ))}
            </ul>
            <p
              id="shows"
              className="mt-8 max-w-2xl scroll-mt-16 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]"
            >
              {LAUNCH.pricing.showsNoteLead}{" "}
              <Link href={LAUNCH.pricing.showsHref} className="text-[var(--ts-accent-text)] hover:underline">
                {LAUNCH.pricing.showsLogin}
              </Link>{" "}
              {LAUNCH.pricing.showsNoteTail}
            </p>
          </div>
        </section>

        <section className="border-t border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)]">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-16 sm:flex-row sm:items-end sm:justify-between sm:py-20">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {LAUNCH.close.heading}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)] sm:text-base">
                {LAUNCH.close.body}
              </p>
            </div>
            <PrimaryLink href={LAUNCH.close.href}>{LAUNCH.close.cta}</PrimaryLink>
          </div>
        </section>
      </main>
    </MarketingChrome>
  );
}
