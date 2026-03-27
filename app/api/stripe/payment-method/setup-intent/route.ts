import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";

export async function POST(request: NextRequest) {
  try {
    // Log key mode to catch test/live mismatch
    const keyPrefix = process.env.STRIPE_SECRET_KEY?.substring(0, 8) || "NOT_SET";
    console.log(`[setup-intent] Stripe key mode: ${keyPrefix}...`);

    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    let customerId = profile.stripe_customer_id;

    // Validate existing customer — may be from a different Stripe mode (live vs test)
    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch {
        console.warn(`[setup-intent] Stale stripe_customer_id ${customerId}, recreating`);
        customerId = null;
      }
    }

    // Create Stripe customer if missing or stale
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email,
        name: profile.full_name,
        metadata: {
          taylslate_profile_id: profile.id,
          company_name: profile.company_name || "",
        },
      });

      await supabaseAdmin
        .from("profiles")
        .update({ stripe_customer_id: customer.id })
        .eq("id", profile.id);

      customerId = customer.id;
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
    });

    return NextResponse.json({ clientSecret: setupIntent.client_secret });
  } catch (err: unknown) {
    // Log full Stripe error details for debugging
    const isStripeError = err && typeof err === "object" && "type" in err;
    if (isStripeError) {
      const stripeErr = err as {
        type: string;
        code?: string;
        message?: string;
        statusCode?: number;
        raw?: unknown;
      };
      console.error("[setup-intent] Stripe error:", {
        type: stripeErr.type,
        code: stripeErr.code,
        message: stripeErr.message,
        statusCode: stripeErr.statusCode,
        raw: stripeErr.raw,
      });

      // Check for key mismatch (test vs live mode)
      if (stripeErr.code === "secret_key_required" || stripeErr.message?.includes("mode")) {
        console.error(
          "[setup-intent] Possible key mismatch: ensure STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY are both test or both live mode. " +
          "Test keys start with sk_test_ / pk_test_, live keys start with sk_live_ / pk_live_."
        );
      }

      return NextResponse.json(
        {
          error: `Stripe error: ${stripeErr.message}`,
          code: stripeErr.code,
          type: stripeErr.type,
        },
        { status: stripeErr.statusCode || 500 }
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[setup-intent] Unexpected error:", err);
    return NextResponse.json(
      { error: `Failed to create setup intent: ${message}` },
      { status: 500 }
    );
  }
}
