// Show profile created when a pitch code or a show sign-up code is verified.
// Requesting the code does not create the account. The source argument only
// labels user_metadata; role and tier are hard-coded and never come from a
// request.
//
// insertShowProfile writes that same row for an auth user id that already
// exists (a password sign-up that never got a profile). The write is keyed
// by id. A row already stored on that id is left as it is.

import { supabaseAdmin } from "@/lib/supabase/admin";

type ShowProfileWrite = { ok: true; role: string } | { ok: false };

export async function insertShowProfile(
  userId: string,
  email: string,
): Promise<ShowProfileWrite> {
  const { error: writeError } = await supabaseAdmin.from("profiles").upsert(
    {
      id: userId,
      email,
      full_name: "",
      role: "show",
      tier: "free",
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (writeError) {
    console.error("[login.otp] profile insert failed:", writeError.message);
  }

  const { data, error: readError } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (readError) {
    console.error("[login.otp] profile read failed:", readError.message);
    return { ok: false };
  }
  const row = data as { id?: string; role?: string | null } | null;
  const role = typeof row?.role === "string" ? row.role : "";
  if (!row?.id || row.id !== userId || !role) return { ok: false };
  return { ok: true, role };
}

export async function createShowAccount(
  email: string,
  source = "email_code",
): Promise<{ ok: true; userId: string } | { ok: false }> {
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { source },
  });
  if (createErr || !created?.user) {
    console.error("[login.otp] createUser failed:", createErr?.message);
    return { ok: false };
  }
  const placed = await insertShowProfile(created.user.id, email);
  if (placed.ok && placed.role === "show") {
    return { ok: true, userId: created.user.id };
  }
  if (!placed.ok) {
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    if (deleteError) {
      console.error("[login.otp] failed to roll back show user:", deleteError.message);
    }
  }
  return { ok: false };
}
