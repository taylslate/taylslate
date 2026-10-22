import type { CSSProperties } from "react";
import { tokens } from "@/lib/brand/tokens";

export const crmRadius: CSSProperties = { borderRadius: tokens.radius };

export const crmCard =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3";
export const crmMuted = "text-sm text-[var(--ts-ink-muted-on-paper)]";
export const crmKicker =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]";
export const primaryButtonClass =
  "inline-flex items-center justify-center bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)] disabled:cursor-not-allowed disabled:opacity-50";
export const ghostButtonClass =
  "inline-flex items-center justify-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)] disabled:cursor-not-allowed disabled:opacity-50";
export const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
export const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";
