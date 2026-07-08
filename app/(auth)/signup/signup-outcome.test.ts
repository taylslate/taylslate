import { describe, it, expect } from "vitest";
import type { AuthError } from "@supabase/supabase-js";
import { classifySignupOutcome } from "./signup-outcome";

// A stand-in AuthError — only .message is read.
const authError = (message: string) => ({ message }) as AuthError;

describe("classifySignupOutcome", () => {
  it("session present → redirect (confirm-off / already-confirmed edge)", () => {
    const outcome = classifySignupOutcome({
      data: { user: { identities: [{ id: "i1" }] }, session: { access_token: "t" } },
      error: null,
    });
    expect(outcome).toEqual({ kind: "session" });
  });

  it("user with identities, no session → check-email (normal confirm-on path)", () => {
    const outcome = classifySignupOutcome({
      data: { user: { identities: [{ id: "i1" }] }, session: null },
      error: null,
    });
    expect(outcome).toEqual({ kind: "check-email" });
  });

  it("user with empty identities → obfuscated (existing confirmed email)", () => {
    const outcome = classifySignupOutcome({
      data: { user: { identities: [] }, session: null },
      error: null,
    });
    expect(outcome).toEqual({ kind: "obfuscated" });
  });

  it("error present → error state carrying the message", () => {
    const outcome = classifySignupOutcome({
      data: { user: null, session: null },
      error: authError("Password should be at least 8 characters."),
    });
    expect(outcome).toEqual({
      kind: "error",
      message: "Password should be at least 8 characters.",
    });
  });

  it("no user, no session, no error → error fallback (never a false promise)", () => {
    const outcome = classifySignupOutcome({
      data: { user: null, session: null },
      error: null,
    });
    expect(outcome.kind).toBe("error");
  });

  it("session takes priority even if identities happen to be empty", () => {
    const outcome = classifySignupOutcome({
      data: { user: { identities: [] }, session: { access_token: "t" } },
      error: null,
    });
    expect(outcome).toEqual({ kind: "session" });
  });
});
