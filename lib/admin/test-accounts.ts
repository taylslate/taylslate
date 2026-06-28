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
