// POST /api/admin/test-login
//
// Founder-only: mint a magic-link session for one of a fixed set of test
// accounts (Layer 1 — "log in as test account"). No UI this layer; returns a
// one-time action_link the founder opens to swap into the target session.
//
// Auth: INTERNAL_ADMIN_EMAILS allowlist only (same gate as mark-delivered and
// founder annotations). The client supplies a `key` that must resolve against
// TEST_ACCOUNTS — never a raw email or user id — so the only reachable targets
// are the whitelisted test accounts.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { isInternalAdmin } from "@/lib/auth/admin";
import { logEvent } from "@/lib/data/events";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TEST_ACCOUNTS } from "@/lib/admin/test-accounts";
import {
  RETURN_TOKEN_COOKIE,
  RETURN_TOKEN_TTL_SECONDS,
  mintReturnToken,
  hashReturnToken,
} from "@/lib/admin/return-token";

export const runtime = "nodejs";

// ~12h. Layer 3 reads this to know who the impersonator is and offer "return to
// admin". Harmless until then.
const ORIGIN_COOKIE = "tslate_impersonation_origin";
const ORIGIN_COOKIE_MAX_AGE = 12 * 60 * 60;

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

interface TestLoginBody {
  key?: unknown;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: TestLoginBody;
  try {
    body = (await request.json()) as TestLoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // The only-test-accounts guarantee: a key from TEST_ACCOUNTS resolves a
  // target. A non-string, an email, or an arbitrary id matches nothing -> 400.
  const account = TEST_ACCOUNTS.find((a) => a.key === body.key);
  if (!account) {
    return NextResponse.json({ error: "Unknown test account key" }, { status: 400 });
  }

  const origin = siteOrigin(request);
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: account.email,
    options: {
      redirectTo: `${origin}/callback?next=/dashboard`,
    },
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error(
      "[admin.test-login] generateLink failed:",
      error?.message,
      "key=",
      account.key
    );
    return NextResponse.json({ error: "Failed to mint login link" }, { status: 500 });
  }

  // Hand back our own server-verifiable callback URL rather than generateLink's
  // action_link. action_link bounces through GoTrue's verify endpoint and returns
  // the session in an implicit-flow URL fragment (#access_token=...) that the
  // /callback route handler can't read; /callback verifies the token_hash with
  // verifyOtp() server-side and sets the target session cookies directly.
  const callbackUrl = `${origin}/callback?token_hash=${encodeURIComponent(
    tokenHash
  )}&type=magiclink&next=${encodeURIComponent("/dashboard")}`;

  // Layer 3 return-to-admin capability: mint an opaque token, persist only its
  // sha256 hash on the audit record (so the log at rest never holds a usable
  // bearer token), and hand the raw token back in an httpOnly cookie. The return
  // path resolves the admin identity from this event's actor_id via the hash —
  // never from cookie contents. logEvent is fail-soft; if it doesn't persist,
  // the token simply won't resolve later (return degrades to sign-out), which is
  // the correct fail-safe and consistent with "audit writes never block".
  const returnToken = mintReturnToken();
  await logEvent({
    eventType: "admin.impersonate",
    entityType: "profile",
    entityId: account.userId,
    actorId: user.id,
    payload: {
      targetKey: account.key,
      targetEmail: account.email,
      targetRole: account.role,
      return_token_hash: hashReturnToken(returnToken),
    },
  });

  const response = NextResponse.json({ url: callbackUrl });
  // Set before returning so the origin is recorded on the same response that
  // hands back the link, ahead of any client-side session swap.
  response.cookies.set(
    ORIGIN_COOKIE,
    JSON.stringify({ adminId: user.id, adminEmail: user.email }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: ORIGIN_COOKIE_MAX_AGE,
    }
  );
  // Opaque return token — httpOnly/Secure/SameSite=Lax, no payload, zero-trust
  // on the client. The redeem path (POST /api/admin/return-to-admin) hashes this
  // and looks up the originating admin.impersonate event.
  response.cookies.set(RETURN_TOKEN_COOKIE, returnToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: RETURN_TOKEN_TTL_SECONDS,
  });
  return response;
}
