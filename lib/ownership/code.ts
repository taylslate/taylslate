// Ownership codes. The plaintext is returned once from start.
// Only the sha256 hex of the uppercase code is stored.

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/** A-Z and 2-9, without 0, O, 1, I, or L. 31 symbols. */
export const OWNERSHIP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const OWNERSHIP_CODE_LENGTH = 6;
export const OWNERSHIP_CODE_PREFIX = "TAYLSLATE-";
export const OWNERSHIP_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CODE_RE = /^TAYLSLATE-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const CODE_IN_TEXT = /TAYLSLATE-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}/gi;

export function generateOwnershipCode(): string {
  let body = "";
  for (let i = 0; i < OWNERSHIP_CODE_LENGTH; i += 1) {
    body += OWNERSHIP_CODE_ALPHABET[randomInt(OWNERSHIP_CODE_ALPHABET.length)];
  }
  return `${OWNERSHIP_CODE_PREFIX}${body}`;
}

export function normalizeOwnershipCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isOwnershipCode(code: string): boolean {
  return CODE_RE.test(normalizeOwnershipCode(code));
}

/** sha256 hex of the uppercase code. */
export function hashOwnershipCode(code: string): string {
  return createHash("sha256").update(normalizeOwnershipCode(code)).digest("hex");
}

export function codeExpiresAt(now: Date): string {
  return new Date(now.getTime() + OWNERSHIP_CODE_TTL_MS).toISOString();
}

/** Constant-time compare of the uppercase code against a stored sha256 hex. */
export function ownershipCodeMatchesHash(code: string, hashHex: string): boolean {
  const computed = createHash("sha256").update(normalizeOwnershipCode(code)).digest();
  const hex = hashHex.trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    timingSafeEqual(computed, computed);
    return false;
  }
  const stored = Buffer.from(hex, "hex");
  if (stored.length !== computed.length) {
    timingSafeEqual(computed, computed);
    return false;
  }
  return timingSafeEqual(computed, stored);
}

function isBoundary(char: string | undefined): boolean {
  if (!char) return true;
  return !/[A-Z0-9]/.test(char);
}

/** Case-insensitive exact code. A longer token that merely contains it does not count. */
export function textHasOwnershipCode(text: string, code: string): boolean {
  const needle = normalizeOwnershipCode(code);
  if (!CODE_RE.test(needle)) return false;
  const source = text.toUpperCase();
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? undefined : source[at - 1];
    const after = source[at + needle.length];
    if (isBoundary(before) && isBoundary(after)) return true;
    from = at + needle.length;
  }
  return false;
}

/**
 * True when any exact code in the text hashes to the stored sha256.
 * Every candidate is compared. The plaintext is not returned.
 */
export function textContainsHashedCode(text: string, hashHex: string): boolean {
  const seen = new Set<string>();
  let found = false;
  for (const match of text.matchAll(CODE_IN_TEXT)) {
    const code = normalizeOwnershipCode(match[0]);
    if (seen.has(code)) continue;
    seen.add(code);
    if (ownershipCodeMatchesHash(code, hashHex)) found = true;
  }
  if (seen.size === 0) {
    const dummy = createHash("sha256").update(`${OWNERSHIP_CODE_PREFIX}AAAAAA`).digest();
    timingSafeEqual(dummy, dummy);
  }
  return found;
}
