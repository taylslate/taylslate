import { NextResponse } from "next/server";

// Returns the Stripe publishable key at runtime.
// NEXT_PUBLIC_* vars are inlined at build time and may be empty if not
// set in the build environment. This endpoint reads from the runtime
// environment so the key is always current.
export async function GET() {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
  if (!publishableKey) {
    console.error("[stripe/config] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set");
    return NextResponse.json(
      { error: "Stripe publishable key not configured" },
      { status: 500 }
    );
  }
  return NextResponse.json({ publishableKey });
}
