// Session gate for brand CRM routes. brandId is always the signed-in user.

import { NextResponse } from "next/server";
import { getAuthenticatedUser, getEffectiveRole } from "@/lib/data/queries";
import { canUseCrm, getProfilePlanId } from "@/lib/entitlements/plan";
import { isBrandSide } from "@/lib/nav/items";

export type CrmGate =
  | { ok: true; brandId: string }
  | { ok: false; response: NextResponse };

export async function requireCrmBrand(): Promise<CrmGate> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sign in required." }, { status: 401 }),
    };
  }

  const role = await getEffectiveRole(user.id);
  if (!role || !isBrandSide(role.effectiveRole)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "CRM is for brand accounts." }, { status: 403 }),
    };
  }

  const planId = await getProfilePlanId(user.id);
  if (!canUseCrm(planId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "CRM is included with Starter." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, brandId: user.id };
}
