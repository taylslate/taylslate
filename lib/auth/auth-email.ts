// Server-verified login identity.
//
// profiles.email is a column the signed-in user can update. A known user id
// is read with auth.admin.getUserById. An email is resolved with
// public.auth_user_ids_for_email, which is service_role only (migration 077).
// A profile row is loaded by that user id afterwards, never by the editable email.

import { supabaseAdmin } from "@/lib/supabase/admin";

export function normalizeAuthEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value ? value : null;
}

export type AuthEmailDirectory =
  | { ok: true; ids: string[] }
  | { ok: false };

/** Auth user ids whose login email is exactly this address. ok false when the read fails. */
export async function listAuthUserIdsByEmail(email: string): Promise<AuthEmailDirectory> {
  const wanted = normalizeAuthEmail(email);
  if (!wanted) return { ok: true, ids: [] };

  const { data, error } = await supabaseAdmin.rpc("auth_user_ids_for_email", {
    lookup: wanted,
  });
  if (error) {
    console.error("[auth-email] auth_user_ids_for_email failed:", error.message);
    return { ok: false };
  }
  if (!Array.isArray(data)) return { ok: false };
  const ids = data.filter((id): id is string => typeof id === "string" && id.length > 0);
  return { ok: true, ids };
}

/** The one auth user with this login email, or null when there is not exactly one. */
export async function getAuthUserIdByEmail(email: string): Promise<string | null> {
  const found = await listAuthUserIdsByEmail(email);
  if (!found.ok || found.ids.length !== 1) return null;
  return found.ids[0];
}

/** Login email for this auth user id. Null when the user is missing or the read fails. */
export async function getAuthEmail(userId: string): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data.user) return null;
  return normalizeAuthEmail(data.user.email);
}

/** Profile id and role for the auth user who logs in as this email. */
export async function profileByLoginEmail(
  email: string,
): Promise<{ id: string; role: string | null } | null> {
  const id = await getAuthUserIdByEmail(email);
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("id", id)
    .maybeSingle();
  if (error || !data?.id) return null;
  return {
    id: data.id as string,
    role: (data.role as string | null) ?? null,
  };
}
