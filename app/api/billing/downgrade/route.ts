import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { downgradeByProfileId } from "@/lib/billing/subscription";

export async function POST() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await downgradeByProfileId(user.id, user.id);
    return NextResponse.json({
      effectiveAt: result.effectiveAt,
      profile: {
        plan: result.profile.plan,
        platform_fee_percentage: result.profile.platform_fee_percentage,
        seat_count: result.profile.seat_count,
        subscription_status: result.profile.subscription_status,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Downgrade failed: ${message}` },
      { status: 400 }
    );
  }
}
