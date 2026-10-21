import Link from "next/link";
import type { ReactNode } from "react";
import { tokens } from "@/lib/brand/tokens";

export const mockupRadius = { borderRadius: tokens.radius };

export const mockupCard =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3";
export const mockupMuted = "text-sm text-[var(--ts-ink-muted-on-paper)]";
export const mockupKicker =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]";
export const primaryButtonClass =
  "inline-flex items-center justify-center bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)] disabled:cursor-not-allowed disabled:opacity-50";
export const ghostButtonClass =
  "inline-flex items-center justify-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)] disabled:cursor-not-allowed disabled:opacity-50";
export const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
export const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";

export function MockupBanner() {
  return (
    <p
      role="status"
      data-testid="mockup-banner"
      className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] px-4 py-2 text-sm text-[var(--ts-ink-on-paper)]"
      style={mockupRadius}
    >
      Mockup. Nothing here is saved.
    </p>
  );
}

export function MockupPage({
  kicker,
  title,
  lede,
  wide = false,
  children,
}: {
  kicker: string;
  title: string;
  lede?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--ts-canvas)] px-4 py-8 text-[var(--ts-ink-on-paper)] sm:px-8">
      <div className={wide ? "mx-auto max-w-5xl" : "mx-auto max-w-3xl"}>
        <MockupBanner />
        <Link
          href="/admin/mockups"
          className="mt-6 inline-block text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
        >
          All mockups
        </Link>
        <p className={`mt-4 ${mockupKicker}`}>{kicker}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        {lede ? <p className={`mt-2 ${mockupMuted}`}>{lede}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

export function MockupLinks({
  links,
  label,
}: {
  links: { href: string; label: string }[];
  label: string;
}) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2" aria-label={label}>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={ghostButtonClass} style={mockupRadius}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center bg-[var(--ts-band-shows)] px-2 py-0.5 text-xs font-medium text-[var(--ts-ink-on-paper)]"
      style={mockupRadius}
    >
      {children}
    </span>
  );
}

const exclusiveOnClass =
  "inline-flex items-center bg-[var(--ts-band-brands)] px-2.5 py-1 text-xs font-medium text-[var(--ts-ink-on-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)]";
const exclusiveOffClass =
  "inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-2.5 py-1 text-xs font-medium text-[var(--ts-ink-muted-on-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)]";

export function ExclusiveMark({ on }: { on: boolean }) {
  return (
    <span className={on ? exclusiveOnClass : exclusiveOffClass} style={mockupRadius}>
      {on ? "Exclusive" : "Not exclusive"}
    </span>
  );
}

export function ExclusiveToggle({
  on,
  showName,
  onToggle,
}: {
  on: boolean;
  showName: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={on ? exclusiveOnClass : exclusiveOffClass}
      style={mockupRadius}
      aria-pressed={on}
      aria-label={`Exclusive for ${showName}`}
      onClick={onToggle}
    >
      {on ? "Exclusive" : "Not exclusive"}
    </button>
  );
}
