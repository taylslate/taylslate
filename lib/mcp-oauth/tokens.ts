// Opaque OAuth values. Only the SHA-256 hex is stored.
// The plaintext exists in the response that issues it, then it is dropped.

import { randomBytes } from "node:crypto";
import { hashKey } from "@/lib/api/keys";

export function hashToken(value: string): string {
  return hashKey(value);
}

export function newAccessToken(): string {
  return `ts_oat_${randomBytes(32).toString("hex")}`;
}

export function newRefreshToken(): string {
  return `ts_ort_${randomBytes(32).toString("hex")}`;
}

export function newAuthCode(): string {
  return `tsac_${randomBytes(32).toString("hex")}`;
}

export function newClientId(): string {
  return `tsc_${randomBytes(16).toString("hex")}`;
}

export const CLIENT_ID_RE = /^tsc_[0-9a-f]{32}$/;
export const ACCESS_TOKEN_RE = /^ts_oat_[0-9a-f]{64}$/;
