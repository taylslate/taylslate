// Hand a managed brand account to its owner.
//
// The auth user id stays. supabase.auth.admin.updateUserById changes the
// login email on that user, then the profile email and is_managed flip in
// one write. Deals, campaigns, IOs, outreach, invoices, and payments are
// keyed to the user id and are not moved.
//
// A second call after is_managed is already false returns 409 and writes
// nothing. If the new email belongs to a different auth user or profile,
// the call refuses and writes nothing.
//
// The audit row is a domain event (account.handoff), not an event_log
// metering row. logEvent is fail-soft. The sign-in mail uses
// bypassManagedReroute so it reaches the new address.
//
// Stripe is not touched. A Stripe customer created earlier keeps the email
// it was created with (lib/stripe/customer.ts sets email only on create).

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/data/events";
import { sendEmail } from "@/lib/email/send";
import { renderLoginMagicEmail } from "@/lib/email/templates/login-magic";
import {
  isValidLoginEmail,
  normalizeLoginEmail,
  loginMagicOtpOptions,
  isLoginMagicSignupLink,
} from "@/lib/auth/login-magic";

const LIST_PAGE_SIZE = 200;
const LIST_PAGE_CAP = 25;

export const HANDOFF_ALREADY =
  "This account has already been handed off";
export const HANDOFF_EMAIL_TAKEN =
  "That email already belongs to another account";

export interface HandoffActor {
  id: string;
  email: string;
}

export type HandoffResult =
  | {
      ok: true;
      id: string;
      email: string;
      isManaged: false;
      emailSent: boolean;
    }
  | { ok: false; status: number; error: string };

interface ProfileRow {
  id: string;
  role: string | null;
  email: string | null;
  is_managed: boolean | null;
}

function ilikeExact(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function isEmailTakenError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "email_exists" ||
    code === "user_already_exists" ||
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("email address has already")
  );
}

/** Auth user ids whose email matches, or null if the lookup failed. */
async function authUserIdsWithEmail(email: string): Promise<string[] | null> {
  const ids: string[] = [];
  for (let page = 1; page <= LIST_PAGE_CAP; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: LIST_PAGE_SIZE,
    });
    if (error) {
      console.error("[handoff] listUsers failed:", error.message);
      return null;
    }
    const users = data.users ?? [];
    for (const user of users) {
      if ((user.email ?? "").toLowerCase() === email) ids.push(user.id);
    }
    if (users.length < LIST_PAGE_SIZE) return ids;
  }
  console.error("[handoff] listUsers page cap reached");
  return null;
}

async function emailBelongsToAnotherAccount(
  email: string,
  selfId: string,
): Promise<"free" | "taken" | "error"> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .ilike("email", ilikeExact(email));
  if (error) {
    console.error("[handoff] profile email lookup failed:", error.message);
    return "error";
  }
  const holders = (data ?? []) as { id: string; email: string | null }[];
  if (
    holders.some(
      (row) => row.id !== selfId && (row.email ?? "").toLowerCase() === email,
    )
  ) {
    return "taken";
  }

  const authIds = await authUserIdsWithEmail(email);
  if (authIds === null) return "error";
  if (authIds.some((id) => id !== selfId)) return "taken";
  return "free";
}

async function sendHandoffMagicLink(email: string, origin: string): Promise<boolean> {
  const nextPath = "/dashboard";
  const redirectTo = `${origin}/callback?next=${encodeURIComponent(nextPath)}`;
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: loginMagicOtpOptions(redirectTo),
  });
  const tokenHash = data?.properties?.hashed_token;
  // A signup link would mean GoTrue did not find the user we just updated.
  // Do not delete that user. The handoff already committed.
  if (isLoginMagicSignupLink(data?.properties?.verification_type)) {
    console.error("[handoff] generateLink returned a signup link for", email);
    return false;
  }
  if (error || !tokenHash) {
    console.error("[handoff] generateLink failed:", error?.message ?? "no token");
    return false;
  }

  const loginUrl = `${origin}/callback?token_hash=${encodeURIComponent(
    tokenHash,
  )}&type=magiclink&next=${encodeURIComponent(nextPath)}`;
  const rendered = renderLoginMagicEmail({ login_url: loginUrl });
  const sent = await sendEmail({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    from: "Taylslate <auth@taylslate.com>",
    bypassManagedReroute: true,
  });
  if (!sent.ok) {
    console.error("[handoff] sign-in email failed:", sent.reason, sent.error);
    return false;
  }
  console.info("[handoff] sign-in link sent to", email);
  return true;
}

export async function handoffManagedBrand(input: {
  profileId: string;
  newEmail: unknown;
  actor: HandoffActor;
  origin: string;
}): Promise<HandoffResult> {
  const newEmail = normalizeLoginEmail(input.newEmail);
  if (!newEmail) {
    return { ok: false, status: 400, error: "email is required" };
  }
  if (!isValidLoginEmail(newEmail)) {
    return { ok: false, status: 400, error: "invalid email" };
  }

  const { data: profileData, error: readError } = await supabaseAdmin
    .from("profiles")
    .select("id, role, email, is_managed")
    .eq("id", input.profileId)
    .single();
  if (readError || !profileData) {
    return { ok: false, status: 404, error: "Profile not found" };
  }
  const profile = profileData as ProfileRow;
  if (profile.role !== "brand") {
    return { ok: false, status: 400, error: "Only a brand account can be handed off" };
  }
  if (profile.is_managed !== true) {
    return { ok: false, status: 409, error: HANDOFF_ALREADY };
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(
    profile.id,
  );
  if (authError || !authData.user) {
    console.error("[handoff] getUserById failed:", authError?.message);
    return { ok: false, status: 500, error: "Couldn't load the login account" };
  }

  const authEmail = (authData.user.email ?? "").toLowerCase();
  const oldEmail = (profile.email ?? "").trim().toLowerCase() || authEmail;
  const authAlreadyNew = authEmail === newEmail;

  if (!authAlreadyNew) {
    const taken = await emailBelongsToAnotherAccount(newEmail, profile.id);
    if (taken === "error") {
      return {
        ok: false,
        status: 500,
        error: "Couldn't check whether that email is already in use",
      };
    }
    if (taken === "taken") {
      return { ok: false, status: 409, error: HANDOFF_EMAIL_TAKEN };
    }

    const { data: updated, error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(profile.id, {
        email: newEmail,
        email_confirm: true,
      });
    if (isEmailTakenError(updateError)) {
      return { ok: false, status: 409, error: HANDOFF_EMAIL_TAKEN };
    }
    if (updateError || !updated.user) {
      console.error("[handoff] updateUserById failed:", updateError?.message);
      return { ok: false, status: 500, error: "Couldn't update the login email" };
    }
    if ((updated.user.email ?? "").toLowerCase() !== newEmail) {
      console.error("[handoff] login email did not switch to", newEmail);
      return { ok: false, status: 500, error: "The login email did not change" };
    }
  }

  const { data: saved, error: saveError } = await supabaseAdmin
    .from("profiles")
    .update({ email: newEmail, is_managed: false })
    .eq("id", profile.id)
    .select("id, email, is_managed")
    .single();
  if (saveError || !saved || saved.is_managed !== false) {
    console.error("[handoff] profile update failed:", saveError?.message);
    return { ok: false, status: 500, error: "Couldn't update the profile" };
  }

  const handedOffAt = new Date().toISOString();
  await logEvent({
    eventType: "account.handoff",
    entityType: "profile",
    entityId: profile.id,
    actorId: input.actor.id,
    payload: {
      actor_email: input.actor.email,
      brand_user_id: profile.id,
      old_email: oldEmail,
      new_email: newEmail,
      timestamp: handedOffAt,
    },
  });

  const emailSent = await sendHandoffMagicLink(newEmail, input.origin);
  return {
    ok: true,
    id: profile.id,
    email: newEmail,
    isManaged: false,
    emailSent,
  };
}
