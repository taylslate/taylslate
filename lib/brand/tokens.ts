/**
 * Shared visual tokens for Taylslate marketing, and later the app.
 *
 * Values live in tokens.css as CSS variables. This module is the JS import
 * surface so a future dashboard restyle can `import { tokens } from "@/lib/brand/tokens"`
 * without copying hex. Do not apply these to authenticated pages yet.
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
  radius: "var(--ts-radius)",
} as const;
