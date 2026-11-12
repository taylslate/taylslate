import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const timingSafeEqual = vi.hoisted(() => vi.fn((left: Buffer, right: Buffer) => left.equals(right)));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return { ...actual, timingSafeEqual };
});

import { isCodeVerifier, isS256Challenge, verifyPkce } from "./pkce";

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

afterEach(() => {
  timingSafeEqual.mockClear();
});

describe("PKCE S256", () => {
  it("accepts the correct verifier and compares with timingSafeEqual", () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = challengeFor(verifier);
    expect(isS256Challenge(challenge)).toBe(true);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalled();
  });

  it("rejects a wrong verifier, a short verifier, and a bad challenge", () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = challengeFor(verifier);
    expect(verifyPkce(`${verifier}x`, challenge)).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
    expect(isCodeVerifier("short")).toBe(false);
    expect(isS256Challenge("not-a-challenge")).toBe(false);
    expect(verifyPkce(verifier, "plain-text-challenge-not-base64url-43")).toBe(false);
    expect(verifyPkce(verifier, "")).toBe(false);
  });
});
