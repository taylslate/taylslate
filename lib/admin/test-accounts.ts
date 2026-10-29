// Impersonable test accounts (Layer 1 — founder "log in as test account").
//
// This is the ONLY source of truth for which accounts the founder test-login
// endpoint can mint a session for. The endpoint accepts a `key` from this list
// and NOTHING else — never a raw email or user id from the client — so the set
// of reachable targets is exactly the entries below. Keep it tiny.

export const TEST_ACCOUNTS = [
  { key: "brand1", label: "Test Brand 1", userId: "052f916b-e4a1-4f3e-8816-3cd53dbf7ccc", email: "chris+brand1@taylslate.com", role: "brand" },
  { key: "show1",  label: "Test Show 1",  userId: "befd31bb-b5ac-4bb7-b2b5-b01f345c4363", email: "chris+show1@taylslate.com",  role: "show"  },
] as const;

export type TestAccountKey = typeof TEST_ACCOUNTS[number]["key"];

// Admin view switch. The cookie stores a key from this list, never a user id
// from the client. An empty user id is not a configured target.
export const ADMIN_VIEW_COOKIE_PREFIX = "test:";

/** Chris's own test agent account, created Oct 29 2026. */
export const ADMIN_TEST_AGENT_USER_ID = "e0592378-1981-4f44-98a1-db67fee0ea79";

export type AdminViewRole = "brand" | "show" | "agent";

export interface AdminViewAccount {
  key: string;
  label: string;
  userId: string;
  email: string;
  role: AdminViewRole;
}

export const ADMIN_VIEW_AGENT: AdminViewAccount = {
  key: "agent1",
  label: "Test Agent 1",
  userId: ADMIN_TEST_AGENT_USER_ID,
  email: "chris+agent@taylslate.com",
  role: "agent",
};

export function adminViewAccounts(): AdminViewAccount[] {
  const owned: AdminViewAccount[] = TEST_ACCOUNTS.map((account) => ({
    key: account.key,
    label: account.label,
    userId: account.userId,
    email: account.email,
    role: account.role,
  }));
  return [...owned, ADMIN_VIEW_AGENT];
}

export function configuredAdminViewAccount(
  role: AdminViewRole,
): AdminViewAccount | null {
  const account = adminViewAccounts().find((entry) => entry.role === role);
  if (!account?.userId) return null;
  return account;
}

export function isAdminViewCookie(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ADMIN_VIEW_COOKIE_PREFIX);
}

export function adminViewAccountFromCookie(
  value: string | null | undefined,
): AdminViewAccount | null {
  if (!isAdminViewCookie(value) || !value) return null;
  const key = value.slice(ADMIN_VIEW_COOKIE_PREFIX.length);
  const account = adminViewAccounts().find((entry) => entry.key === key);
  if (!account?.userId) return null;
  return account;
}

export function adminViewCookieValue(account: AdminViewAccount): string {
  return `${ADMIN_VIEW_COOKIE_PREFIX}${account.key}`;
}
