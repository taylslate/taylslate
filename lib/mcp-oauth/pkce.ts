// PKCE S256 only. plain and a missing method are rejected by the caller.

import { createHash, timingSafeEqual } from "node:crypto";

const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

export function isS256Challenge(value: string): boolean {
  return CHALLENGE_RE.test(value);
}

export function isCodeVerifier(value: string): boolean {
  return VERIFIER_RE.test(value);
}

export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!isCodeVerifier(verifier) || !isS256Challenge(challenge)) return false;
  const actual = Buffer.from(s256Challenge(verifier));
  const expected = Buffer.from(challenge);
  if (actual.length !== expected.length) {
    timingSafeEqual(actual, actual);
    return false;
  }
  return timingSafeEqual(actual, expected);
}
