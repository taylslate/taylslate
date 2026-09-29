import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { tokens } from "@/lib/brand/tokens";

export const inputClass =
  "w-full border border-[var(--ts-ink-on-paper)]/15 bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:outline-none";
export const labelClass =
  "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";
export const primaryBtnClass =
  "w-full bg-[var(--ts-ink-on-paper)] py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <MarketingChrome
      actions={
        <Link
          href="/signup"
          className="hidden bg-[var(--ts-ink-on-paper)] px-3.5 py-1.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 sm:inline-flex"
          style={{ borderRadius: tokens.radius }}
        >
          Get started
        </Link>
      }
    >
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </MarketingChrome>
  );
}
