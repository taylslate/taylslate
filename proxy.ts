import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // Public routes
  // /callback                    — Supabase auth completion (verifyOtp /
  //                                exchangeCodeForSession). Must be reachable
  //                                while signed out — it's how a magic-link /
  //                                OTP user establishes a session in the first
  //                                place. It only sets a session on a valid
  //                                token; otherwise it redirects to /login.
  // /login/show                  — redirects to /login (one code sign-in)
  // /forgot-password             — request a password reset (signed out)
  // /reset-password              — set a new password after a recovery link;
  //                                must be reachable so it can render its own
  //                                "link expired" state instead of bouncing to
  //                                /login when no recovery session exists.
  // /outreach/[token]            — Wave 11 public pitch page (token-gated)
  // /auth/magic                  — magic link landing/error states
  // /for-shows                   — public shows marketing page
  // /terms                       public terms of service draft (exact path)
  // /privacy                     public privacy policy draft (exact path)
  // /sitemap.xml, /robots.txt, /opengraph-image: public crawler files
  // /api/webhooks/docusign       — Wave 12 DocuSign Connect webhook (HMAC-verified)
  // /api/cron/*                  — Vercel Cron jobs (CRON_SECRET-verified)
  // /api/v1                      public API. Handlers authenticate Bearer keys.
  // All /api/* are listed; per-route handlers enforce their own auth.
  const isPublicRoute =
    pathname === "/" ||
    pathname === "/for-shows" ||
    pathname === "/terms" ||
    pathname === "/privacy" ||
    pathname === "/login" ||
    pathname === "/login/show" ||
    pathname === "/signup" ||
    pathname === "/callback" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/api/v1" || pathname.startsWith("/api/v1/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/outreach/") ||
    pathname.startsWith("/auth/magic") ||
    pathname === "/sitemap.xml" ||
    pathname === "/robots.txt" ||
    pathname === "/opengraph-image";

  if (isPublicRoute) return supabaseResponse;

  // Protected routes — redirect to login
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
