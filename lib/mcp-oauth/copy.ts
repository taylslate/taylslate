// Consent copy. No server imports. The screen ships this text as written.

export const EXPIRED_COPY = "This sign-in link has expired. Start the connection again from your app.";
export const PLAN_COPY = "Your plan does not include API access.";
export const UNAVAILABLE_COPY = "Taylslate can't complete this connection right now. Try again later.";

export const SCOPE_LINES = {
  read: "See your shows, campaigns, plans, deals and proposals.",
  "write:campaigns": "Propose campaigns. You approve each one in Taylslate.",
  "write:outreach": "Draft outreach. You approve each one in Taylslate.",
} as const;

export type ConsentScope = keyof typeof SCOPE_LINES;
