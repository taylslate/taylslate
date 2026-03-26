import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";

export async function POST(request: NextRequest) {
  try {
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

    if (profile.role !== "brand" && profile.role !== "agency") {
      return NextResponse.json(
        { error: "Only brand and agency users can create Stripe customers" },
        { status: 403 }
      );
    }

    // Return existing customer if already created
    if (profile.stripe_customer_id) {
      return NextResponse.json({ customerId: profile.stripe_customer_id });
    }

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

    return NextResponse.json({ customerId: customer.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create Stripe customer: ${message}` },
      { status: 500 }
    );
  }
}
