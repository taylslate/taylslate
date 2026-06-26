// Internal-admin gate.
//
// The founder / ops allowlist is the INTERNAL_ADMIN_EMAILS env var
// (comma-separated). Used by admin-only API routes (mark-delivered, the
// charge-episode ops path, founder annotations) and by server components that
// surface founder-only UI. Centralised here so the allowlist parse lives in one
// place rather than being copy-pasted per route.

export function isInternalAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.INTERNAL_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
