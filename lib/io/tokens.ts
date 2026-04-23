// HS256 JSON Web Tokens for tokenized public links.
//
// Two payload shapes share this module:
//   - OutreachTokenPayload — drives the public pitch page (/outreach/[token])
//   - MagicLinkPayload     — drives the email-based account creation flow
//
// We stay HS256 for simplicity (single shared secret per token type, no key
// rotation infrastructure yet). Tokens are signed with their *own* secret so
// leaking one secret does not compromise the other.

import { createHmac, timingSafeEqual } from "node:crypto";

// ---------- types ----------

export interface OutreachTokenPayload {
  outreach_id: string;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Schema version — bump when payload shape changes. */
  v: 1;
}

export interface MagicLinkPayload {
  email: string;
  /** Where to redirect the user after onboarding completes. */
  return_url: string;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expiry, unix seconds. Magic links die after 24h. */
  exp: number;
  v: 1;
}

export type TokenPurpose = "outreach" | "magic";

// ---------- base64url ----------

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(normalized, "base64");
}

// ---------- secret resolution ----------

function getSecret(purpose: TokenPurpose): string {
  const envName =
    purpose === "outreach" ? "OUTREACH_TOKEN_SECRET" : "MAGIC_LINK_TOKEN_SECRET";
  const secret = process.env[envName];
  if (!secret || secret.length < 16) {
    // Fall back to a dev-only secret so local development doesn't crash.
    // Production must set the real env var (build will warn if missing).
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${envName} is not set`);
    }
    return `__dev_${purpose}_secret_do_not_use_in_prod__`;
  }
  return secret;
}

// ---------- core sign/verify ----------

const HEADER = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function sign(payload: object, purpose: TokenPurpose): string {
  const body = b64urlEncode(JSON.stringify(payload));
  const data = `${HEADER}.${body}`;
  const sig = createHmac("sha256", getSecret(purpose)).update(data).digest();
  return `${data}.${b64urlEncode(sig)}`;
}

function verify<T>(token: string, purpose: TokenPurpose): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  if (header !== HEADER) return null;

  const expectedSig = createHmac("sha256", getSecret(purpose))
    .update(`${header}.${body}`)
    .digest();
  let providedSig: Buffer;
  try {
    providedSig = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  try {
    return JSON.parse(b64urlDecode(body).toString("utf8")) as T;
  } catch {
    return null;
  }
}

// ---------- public API: outreach ----------

export function signOutreachToken(outreachId: string): string {
  const payload: OutreachTokenPayload = {
    outreach_id: outreachId,
    iat: Math.floor(Date.now() / 1000),
    v: 1,
  };
  return sign(payload, "outreach");
}

/** Returns the payload if the signature is valid, otherwise null. No expiry check. */
export function verifyOutreachToken(token: string): OutreachTokenPayload | null {
  const payload = verify<OutreachTokenPayload>(token, "outreach");
  if (!payload || payload.v !== 1 || typeof payload.outreach_id !== "string") {
    return null;
  }
  return payload;
}

// ---------- public API: magic link ----------

const MAGIC_LINK_TTL_SECONDS = 24 * 60 * 60;

export function signMagicLinkToken(
  email: string,
  returnUrl: string,
  ttlSeconds: number = MAGIC_LINK_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: MagicLinkPayload = {
    email: email.toLowerCase().trim(),
    return_url: returnUrl,
    iat: now,
    exp: now + ttlSeconds,
    v: 1,
  };
  return sign(payload, "magic");
}

export function verifyMagicLinkToken(token: string): MagicLinkPayload | null {
  const payload = verify<MagicLinkPayload>(token, "magic");
  if (!payload || payload.v !== 1) return null;
  if (typeof payload.email !== "string" || typeof payload.return_url !== "string") {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}
