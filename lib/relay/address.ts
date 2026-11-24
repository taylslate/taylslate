// Per-outreach reply address. The token is 128 random bits.
// It is not derived from an outreach, deal, brand, or show id.

import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const TOKEN = /^[a-z2-7]{26}$/;
const OUTREACH_REPLY = "outreach@taylslate.com";
const RELAY_DOMAIN = "reply.taylslate.com";

export function randomRelayToken(): string {
  return encodeBase32(randomBytes(16));
}

export function relayAddress(token: string): string {
  return `r-${token}@${RELAY_DOMAIN}`;
}

export function parseRelayAddress(addr: string): string | null {
  if (typeof addr !== "string") return null;
  const trimmed = addr.trim();
  if (!trimmed || trimmed.includes(",") || trimmed.includes(";")) return null;
  let email = trimmed;
  const angle = trimmed.match(/^[^<]*<([^<>]+)>$/);
  if (angle) email = angle[1].trim();
  if (email.includes(" ") || email.split("@").length !== 2) return null;
  const [local, domain] = email.split("@");
  if (!domain || domain.toLowerCase() !== RELAY_DOMAIN) return null;
  const match = local.toLowerCase().match(/^r-([a-z2-7]{26})$/);
  if (!match) return null;
  return TOKEN.test(match[1]) ? match[1] : null;
}

export function relayReplyTo(thread: { address_token: string } | null): string {
  if (process.env.RELAY_INBOUND_ENABLED === "true" && thread && TOKEN.test(thread.address_token)) {
    return relayAddress(thread.address_token);
  }
  return OUTREACH_REPLY;
}

function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}
