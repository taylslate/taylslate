// Shared cron bearer check. Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>`. A missing secret is unauthorized,
// except when a route opts into local dev. Never log the header or the secret.

import { timingSafeEqual } from "node:crypto";

export function isCronAuthorized(
  req: Request,
  opts?: { allowUnsetSecretOutsideProduction?: boolean }
): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return (
      opts?.allowUnsetSecretOutsideProduction === true &&
      process.env.NODE_ENV !== "production"
    );
  }
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
