// Who may write a catalog show.
//
// True for an internal admin (INTERNAL_ADMIN_EMAILS, or a profile role
// of admin), an agent whose roster link is approved, and a show user
// tied by getVerifiedProfileTies. shows.agent_id alone is not enough.
// A pending or rejected link does not grant edit rights.
// A podscan id on the profile is not a tie. Anyone else is false.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isInternalAdmin } from "@/lib/auth/admin";
import { getVerifiedProfileTies } from "@/lib/shows/apply-geography";

const ADMIN_WRITE_FIELDS = [
  "agent_id",
  "is_verified",
  "is_claimed",
  "podscan_id",
  "is_discoverable",
] as const;

interface ProfileRow {
  id?: string;
  email?: string | null;
  role?: string | null;
}

interface ShowRow {
  id?: string;
  contact_email?: string | null;
  data_sources?: unknown;
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

export async function isShowsAdmin(userId: string): Promise<boolean> {
  const profile = await loadProfile(userId);
  if (!profile) return false;
  return profile.role === "admin" || isInternalAdmin(profile.email);
}

export async function canEditShow(userId: string, showId: string): Promise<boolean> {
  if (!userId || !showId) return false;
  if (await isShowsAdmin(userId)) return true;

  const profile = await loadProfile(userId);
  if (!profile) return false;

  const { data, error } = await supabaseAdmin
    .from("shows")
    .select("id, contact_email, data_sources")
    .eq("id", showId)
    .maybeSingle();
  if (error || !data) return false;
  const show = data as ShowRow;

  const { data: rel, error: relError } = await supabaseAdmin
    .from("agent_show_relationships")
    .select("id")
    .eq("agent_id", userId)
    .eq("show_id", showId)
    .eq("status", "approved")
    .maybeSingle();
  if (relError) return false;
  if (rel) return true;

  if (profile.role !== "show") return false;

  const { data: showProfile, error: profileError } = await supabaseAdmin
    .from("show_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError || !showProfile) return false;
  const profileId = (showProfile as { id?: string }).id;
  if (!profileId) return false;

  const ties = await getVerifiedProfileTies([
    {
      showId,
      contactEmail: show.contact_email ?? undefined,
      dataSources: textList(show.data_sources),
    },
  ]);
  return ties.some((tie) => tie.showId === showId && tie.profileId === profileId);
}

/** Drop id, created_at, and admin-only columns unless the caller is an admin. */
export function showWritePatch(
  body: Record<string, unknown>,
  admin: boolean
): Record<string, unknown> {
  const next = { ...body };
  delete next.id;
  delete next.created_at;
  if (!admin) {
    for (const field of ADMIN_WRITE_FIELDS) delete next[field];
  }
  return next;
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, role")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ProfileRow;
}
