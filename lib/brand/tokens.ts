/**
 * Shared visual tokens for Taylslate marketing and dashboard chrome.
 *
 * Values live in tokens.css as CSS variables. Import this module instead of
 * copying hex. Applied on homepage, /login, the authenticated dashboard
 * shell (layout + sidebar + /dashboard), the /campaigns list,
 * /campaigns/new (returning check-in + brief),
 * /campaigns/[id]/interpretation, and the v2 conviction discovery
 * view at /campaigns/[id].
 * Signup, onboarding, legacy campaign detail and discovery list,
 * deals, invoices, and settings page bodies still use --brand-*
 * until those restyles land.
 */
export const tokens = {
  field: "var(--ts-field)",
  ink: "var(--ts-ink)",
  inkMuted: "var(--ts-ink-muted)",
  paper: "var(--ts-paper)",
  inkOnPaper: "var(--ts-ink-on-paper)",
  inkMutedOnPaper: "var(--ts-ink-muted-on-paper)",
  accent: "var(--ts-accent)",
  hairline: "var(--ts-hairline)",
  hairlineOnPaper: "var(--ts-hairline-on-paper)",
  radius: "var(--ts-radius)",
  bandBrands: "var(--ts-band-brands)",
  bandShows: "var(--ts-band-shows)",
} as const;
