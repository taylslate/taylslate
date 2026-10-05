/**
 * Shared visual tokens for Taylslate marketing and dashboard chrome.
 *
 * Values live in tokens.css as CSS variables. Import this module instead of
 * copying hex. Applied on homepage, /login, /signup, /forgot-password,
 * /reset-password, /auth/magic, the authenticated dashboard shell
 * (layout + sidebar + /dashboard), the /campaigns list,
 * /campaigns/new (returning check-in + brief),
 * /campaigns/[id]/interpretation, the v2 conviction discovery
 * view at /campaigns/[id], the legacy campaign detail and
 * discovery list at /campaigns/[id], /campaigns/generated, the
 * media plan at /campaigns/[id]/plan, brand outreach at
 * /campaigns/[id]/outreach, the deals list at /deals, deal
 * detail at /deals/[id] (Wave 12 sign flow and the legacy edit),
 * the IO page at /deals/[id]/io, new deal at /deals/new, import
 * at /deals/import, the invoices list at
 * /invoices and invoice detail at /invoices/[id], the public
 * pitch page at /outreach/[token], brand settings at /settings,
 * /settings/brand-profile, and /settings/billing, the aircheck
 * review at /admin/airchecks/[ioLineItemId], the onboarding role
 * picker, /onboarding/brand/*, /shows, and /onboarding/show/*.
 * globals.css still defines --brand-*. No page uses those variables.
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
