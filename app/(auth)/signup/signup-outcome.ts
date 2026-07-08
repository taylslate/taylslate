import type { AuthError } from "@supabase/supabase-js";

// The distinct ways supabase.auth.signUp() resolves, as outcomes the UI
// switches on. Kept separate from React so the branch logic is testable in
// isolation (see signup-outcome.test.ts).
export type SignupOutcome =
  | { kind: "error"; message: string }
  // A session was issued: confirm-email is off, or the address was already
  // confirmed on an edge path. Either way the user is signed in now.
  | { kind: "session" }
  // New user created, awaiting email confirmation (the normal confirm-on path).
  | { kind: "check-email" }
  // Existing confirmed email: Supabase returns a decoy user with an empty
  // identities array to avoid leaking account existence. We render this
  // identically to check-email so the leak stays closed.
  | { kind: "obfuscated" };

// Minimal shape of signUp()'s resolved value that we branch on.
interface SignUpResultLike {
  data: {
    user: { identities?: unknown[] | null } | null;
    session: unknown | null;
  };
  error: AuthError | null;
}

export function classifySignupOutcome({
  data,
  error,
}: SignUpResultLike): SignupOutcome {
  if (error) return { kind: "error", message: error.message };
  // Session first: it's the strongest positive signal (already authenticated).
  if (data.session) return { kind: "session" };
  // Decoy user for an existing confirmed email: populated user, empty
  // identities, no session. Detect before the plain-user branch.
  if (
    data.user &&
    Array.isArray(data.user.identities) &&
    data.user.identities.length === 0
  ) {
    return { kind: "obfuscated" };
  }
  if (data.user) return { kind: "check-email" };
  // No user, no session, no error: unexpected. Surface it rather than promise
  // an email that may never arrive.
  return { kind: "error", message: "Something went wrong. Please try again." };
}
