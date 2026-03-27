import { NextResponse } from "next/server";

// Returns the Stripe publishable key at runtime.
// NEXT_PUBLIC_* vars are inlined at build time and may be empty if not
// set in the build environment. This endpoint reads from the runtime
// environment so the key is always current.
export async function GET() {
  // Check both names — NEXT_PUBLIC_* may not be available as a runtime
  // env var in Vercel serverless functions (it's a build-time concept).
  // Users should set STRIPE_PUBLISHABLE_KEY in Vercel env vars as well,
  // or the NEXT_PUBLIC_ version will work if Vercel propagates it.
  const publishableKey =
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    "";

  if (!publishableKey) {
    console.error(
      "[stripe/config] Neither STRIPE_PUBLISHABLE_KEY nor NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is set. " +
      "Add STRIPE_PUBLISHABLE_KEY to your Vercel environment variables."
    );
    return NextResponse.json(
      { error: "Stripe publishable key not configured" },
      { status: 500 }
    );
  }
  return NextResponse.json({ publishableKey });
}
