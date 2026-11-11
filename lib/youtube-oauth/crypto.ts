// AES-256-GCM for Google tokens. Output is v1.<iv>.<tag>.<ciphertext>,
// each part base64url. Decrypt rejects any other version or a bad tag.
// Plaintext is never logged and never put in an error string.

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

function b64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function fromB64url(value: string): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0) return null;
  return bytes;
}

export function encryptString(plaintext: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("encrypt failed");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${b64url(iv)}.${b64url(tag)}.${b64url(ciphertext)}`;
}

export function decryptString(sealed: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("decrypt failed");
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("decrypt failed");
  const iv = fromB64url(parts[1] ?? "");
  const tag = fromB64url(parts[2] ?? "");
  const ciphertext = fromB64url(parts[3] ?? "");
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !ciphertext) {
    throw new Error("decrypt failed");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    throw new Error("decrypt failed");
  }
}

export interface OauthCookiePayload {
  state_hash: string;
  verifier: string;
  user_id: string;
  issued_at: number;
}

export function sealJson(value: OauthCookiePayload, key: Buffer): string {
  return encryptString(JSON.stringify(value), key);
}

export function openJson(sealed: string, key: Buffer): OauthCookiePayload | null {
  let plain: string;
  try {
    plain = decryptString(sealed, key);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(plain) as Partial<OauthCookiePayload>;
    if (typeof parsed.state_hash !== "string" || !parsed.state_hash) return null;
    if (typeof parsed.verifier !== "string" || !parsed.verifier) return null;
    if (typeof parsed.user_id !== "string" || !parsed.user_id) return null;
    if (typeof parsed.issued_at !== "number" || !Number.isFinite(parsed.issued_at)) return null;
    return {
      state_hash: parsed.state_hash,
      verifier: parsed.verifier,
      user_id: parsed.user_id,
      issued_at: parsed.issued_at,
    };
  } catch {
    return null;
  }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
