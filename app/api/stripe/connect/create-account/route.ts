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

    if (profile.role !== "agent" && profile.role !== "show") {
      return NextResponse.json(
        { error: "Only agents and shows can create Connect accounts" },
        { status: 403 }
      );
    }

    const account = await stripe.accounts.create({
      type: "express",
      email: profile.email,
      metadata: {
        taylslate_profile_id: profile.id,
      },
    });

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ stripe_connect_account_id: account.id })
      .eq("id", profile.id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to save Connect account ID" },
        { status: 500 }
      );
    }

    return NextResponse.json({ accountId: account.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create Connect account: ${message}` },
      { status: 500 }
    );
  }
}
