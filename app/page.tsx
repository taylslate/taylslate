import type { Metadata } from "next";
import Link from "next/link";
import { tokens } from "@/lib/brand/tokens";

export const metadata: Metadata = {
  title: "Taylslate — Run creator sponsorships without an agency",
  description:
    "Tell us the product and who buys it. We interpret the brief, build a test portfolio, write the insertion order, and pay the show when the read runs.",
};

const steps = [
  {
    n: "01",
    title: "Interpret the brief",
    body: "You describe the product, the customer, and the budget. We send back a read of where a host-read should work, and you confirm it before we look for shows.",
  },
  {
    n: "02",
    title: "Build the test portfolio",
    body: "A short list of podcasts and long-form YouTube shows you can actually test. Three spots is the usual first buy, not a forty-show plan.",
  },
  {
    n: "03",
    title: "Close and pay",
    body: "You pick the shows. Outreach, the insertion order, and signatures live in one thread. Card on file. The show is paid when the episode delivers.",
  },
] as const;

export default function Home() {
  return (
    <div className="marketing-page flex min-h-screen flex-col bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      <header className="border-b border-[var(--ts-ink-on-paper)]/10">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="flex h-7 w-7 items-center justify-center border border-[var(--ts-ink-on-paper)]/15 text-[13px] font-semibold tracking-tight"
              style={{ borderRadius: tokens.radius }}
            >
              T
            </span>
            <span className="text-[15px] font-semibold tracking-tight">
              taylslate
            </span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/login"
              className="text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="bg-[var(--ts-ink-on-paper)] px-3.5 py-1.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90"
              style={{ borderRadius: tokens.radius }}
            >
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 pt-16 pb-14 text-center sm:pt-20 sm:pb-16">
          <p className="mb-6 inline-flex items-center justify-center gap-3 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-ink-muted-on-paper)]">
            <span
              className="inline-block h-3 w-0.5 bg-[var(--ts-accent)]"
              aria-hidden
            />
            Podcast and YouTube host-reads
          </p>

          <h1 className="text-[2.35rem] font-semibold leading-[1.12] tracking-tight sm:text-5xl">
            Run creator sponsorships without an agency.
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[var(--ts-ink-muted-on-paper)] sm:text-lg">
            Tell us the product and who buys it. We interpret the brief, build a
            test portfolio, write the insertion order, and pay the show when the
            read runs.
          </p>

          <Link
            href="/signup"
            className="mt-10 inline-flex bg-[var(--ts-ink-on-paper)] px-5 py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90"
            style={{ borderRadius: tokens.radius }}
          >
            Get started
          </Link>
        </section>

        <section className="border-t border-[var(--ts-ink-on-paper)]/10">
          <ol className="mx-auto grid max-w-5xl grid-cols-1 divide-y divide-[var(--ts-ink-on-paper)]/10 px-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {steps.map((step) => (
              <li
                key={step.n}
                className="py-8 sm:px-8 sm:py-12 first:sm:pl-0 last:sm:pr-0"
              >
                <p className="text-[11px] font-medium tracking-[0.16em] text-[var(--ts-ink-muted-on-paper)]">
                  {step.n}
                </p>
                <h2 className="mt-2 text-lg font-semibold tracking-tight">
                  {step.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-[var(--ts-ink-on-paper)]/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <span className="text-sm text-[var(--ts-ink-muted-on-paper)]">
            &copy; 2026 Taylslate
          </span>
          <div className="flex items-center gap-6">
            <Link
              href="#"
              className="text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
            >
              Terms
            </Link>
            <Link
              href="#"
              className="text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
            >
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
