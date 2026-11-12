// Show profile created when a pitch code or a show sign-up code is verified.
// Requesting the code does not create the account. The source argument only
// labels user_metadata; role and tier are hard-coded and never come from a
// request.

import { supabaseAdmin } from "@/lib/supabase/admin";

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
  const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
    id: created.user.id,
    email,
    full_name: "",
    role: "show",
    tier: "free",
  });
  if (profileErr) {
    console.error("[login.otp] profile insert failed:", profileErr.message);
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    if (deleteError) {
      console.error("[login.otp] failed to roll back show user:", deleteError.message);
    }
    return { ok: false };
  }
  return { ok: true, userId: created.user.id };
}
