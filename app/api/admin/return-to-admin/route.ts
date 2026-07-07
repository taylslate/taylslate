// POST /api/admin/return-to-admin
//
// Founder-only Layer 3: swap an impersonated test-account session back to the
// originating admin session WITHOUT signing out and re-authenticating.
//
// Security model — the opaque return token IS the capability. The caller here is
// the impersonated test account, NOT an admin, so we cannot gate on the caller's
// identity. Instead:
//   1. Read the raw token from the httpOnly `tslate_return_token` cookie.
//   2. Hash it and look up the originating admin.impersonate event by
//      payload->>return_token_hash. The event's actor_id — resolved server-side
//      from the database — is the ONLY source of the admin identity. The
//      plaintext `tslate_impersonation_origin` cookie is never read here; it is
//      zero-authority (banner label only).
//   3. Enforce an 8h TTL on the event's created_at.
//   4. Re-check isInternalAdmin against the admin's CURRENT email (fresh from
//      auth) so a demoted admin's stale token is rejected.
//   5. Single-use: atomically insert the admin.impersonation_ended sentinel with
//      a deterministic PK derived from the impersonate event id BEFORE minting
//      the callback. The primary-key uniqueness is the gate — a concurrent or
//      repeated redeem collides (SQLSTATE 23505) and is rejected. Because a
//      callback URL is produced only AFTER this write is confirmed (not via the
//      fail-soft logEvent helper), a failed write yields 500, never a reusable
//      session. Append-only preserved (insert, not payload mutation).
// Every failure returns a generic 403 (no leaking which check failed).

import { NextRequest, NextResponse } from "next/server";
import { isInternalAdmin } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  RETURN_TOKEN_COOKIE,
  RETURN_TOKEN_TTL_SECONDS,
  hashReturnToken,
  impersonationEndedEventId,
} from "@/lib/admin/return-token";

export const runtime = "nodejs";

const ORIGIN_COOKIE = "tslate_impersonation_origin";

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// Clear both impersonation cookies on the returning response so the swapped-back
// admin session carries no residual impersonation state and the (now-spent)
// token can't be replayed from the browser.
function clearImpersonationCookies(response: NextResponse): NextResponse {
  for (const name of [RETURN_TOKEN_COOKIE, ORIGIN_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}

export async function POST(request: NextRequest) {
  // 1. Token must be present.
  const rawToken = request.cookies.get(RETURN_TOKEN_COOKIE)?.value;
  if (!rawToken) {
    return forbidden();
  }
  const tokenHash = hashReturnToken(rawToken);

  // 2. Resolve the originating impersonate event by token hash. Service role
  // bypasses RLS; the query is scoped to the tiny admin.impersonate subset.
  const { data: events, error: lookupError } = await supabaseAdmin
    .from("domain_events")
    .select("id, actor_id, created_at, payload")
    .eq("event_type", "admin.impersonate")
    .eq("payload->>return_token_hash", tokenHash)
    .limit(1);
  if (lookupError) {
    console.error("[admin.return-to-admin] event lookup failed:", lookupError.message);
    return forbidden();
  }
  const impersonateEvent = events?.[0];
  if (!impersonateEvent) {
    return forbidden();
  }

  // 3. Server-side TTL: reject tokens whose impersonate event is older than 8h.
  const ageMs = Date.now() - Date.parse(impersonateEvent.created_at);
  if (!Number.isFinite(ageMs) || ageMs > RETURN_TOKEN_TTL_SECONDS * 1000) {
    return forbidden();
  }

  // 4. Resolve the admin's CURRENT identity from the event's actor_id and
  // re-check the internal-admin allowlist — a demoted admin's token is rejected.
  // Done before consuming the token so a transient auth error doesn't burn it.
  const adminId = impersonateEvent.actor_id;
  if (!adminId) {
    return forbidden();
  }
  const { data: adminUser, error: adminError } =
    await supabaseAdmin.auth.admin.getUserById(adminId);
  const adminEmail = adminUser?.user?.email;
  if (adminError || !adminEmail || !isInternalAdmin(adminEmail)) {
    return forbidden();
  }

  // 5. Single-use — the atomic gate. Insert the admin.impersonation_ended
  // sentinel with a deterministic PK derived from the impersonate event id. This
  // must succeed BEFORE we mint any session, so a callback URL is only ever
  // produced once per token. A unique-violation (23505) means the token was
  // already spent (a prior return or a concurrent racer that won) -> 403. Any
  // other write error fails closed (500) rather than handing out a session we
  // couldn't record. Written directly (not via the fail-soft logEvent helper)
  // precisely because its durability is a security guarantee here, not just audit.
  const { error: sentinelError } = await supabaseAdmin
    .from("domain_events")
    .insert({
      id: impersonationEndedEventId(impersonateEvent.id),
      event_type: "admin.impersonation_ended",
      entity_type: "profile",
      entity_id: adminId,
      actor_id: adminId,
      schema_version: "v1",
      payload: {
        impersonate_event_id: impersonateEvent.id,
        adminEmail,
        targetEmail: impersonateEvent.payload?.targetEmail ?? null,
        targetKey: impersonateEvent.payload?.targetKey ?? null,
      },
    });
  if (sentinelError) {
    if (sentinelError.code === "23505") {
      return forbidden();
    }
    console.error(
      "[admin.return-to-admin] sentinel insert failed:",
      sentinelError.message
    );
    return NextResponse.json(
      { error: "Failed to record return" },
      { status: 500 }
    );
  }

  // Token is now spent. Mint a server-verifiable callback URL for the admin —
  // same proven flow as test-login: generateLink returns a hashed_token that
  // /callback verifies with verifyOtp() server-side (no implicit-flow fragment,
  // no /auth/callback).
  const origin = siteOrigin(request);
  const { data: linkData, error: linkError } =
    await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: adminEmail,
      options: { redirectTo: `${origin}/callback?next=/dashboard` },
    });
  const hashedToken = linkData?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    console.error(
      "[admin.return-to-admin] generateLink failed:",
      linkError?.message
    );
    return NextResponse.json(
      { error: "Failed to mint return link" },
      { status: 500 }
    );
  }
  const callbackUrl = `${origin}/callback?token_hash=${encodeURIComponent(
    hashedToken
  )}&type=magiclink&next=${encodeURIComponent("/dashboard")}`;

  const response = NextResponse.json({ url: callbackUrl });
  return clearImpersonationCookies(response);
}
