"use server";

import { cookies } from "next/headers";
import { RECOVERY_COOKIE, RECOVERY_COOKIE_OPTIONS } from "@/lib/auth/recovery-cookie";

// Clear the one-time recovery marker after a successful password reset so it
// can't linger for its TTL and re-open the set-password form in the same
// browser. Best-effort hygiene — the actual reset is already committed.
export async function clearRecoveryCookie() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: RECOVERY_COOKIE, path: RECOVERY_COOKIE_OPTIONS.path });
}
