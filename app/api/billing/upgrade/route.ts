import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { upgradeByProfileId } from "@/lib/billing/subscription";
import type { PlanId } from "@/lib/billing/plans";

const ALLOWED_TARGETS: Array<Exclude<PlanId, "pay_as_you_go">> = [
  "operator",
  "agency",
];

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { targetPlan?: string };
    const targetPlan = body.targetPlan as Exclude<PlanId, "pay_as_you_go">;

    if (!ALLOWED_TARGETS.includes(targetPlan)) {
      return NextResponse.json(
        {
          error: `Invalid targetPlan: must be one of ${ALLOWED_TARGETS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const result = await upgradeByProfileId(user.id, targetPlan, user.id);
    return NextResponse.json({
      subscriptionId: result.subscriptionId,
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
      { error: `Upgrade failed: ${message}` },
      { status: 400 }
    );
  }
}
