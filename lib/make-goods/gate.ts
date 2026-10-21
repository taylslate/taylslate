// Shared gate for make-good routes.
// The deal is loaded first. Brand is deals.brand_id or the user on
// deals.brand_profile_id. Show is deals.show_profile_id. Nothing is
// written until the caller is one of those parties, and a decision
// is written only for the brand.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { loadDealAccess, type DealRef } from "./access";

type User = NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>;

export type GateOk = {
  ok: true;
  user: User;
  deal: DealRef;
  canApprove: boolean;
};

export type GateResult = GateOk | { ok: false; response: NextResponse };

export async function gateMakeGood(
  dealId: string,
  mode: "read" | "decide"
): Promise<GateResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const access = await loadDealAccess(dealId, user.id);
  if (!access.deal) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Deal not found" }, { status: 404 }),
    };
  }

  if (mode === "decide" && access.role !== "brand") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only the brand on this deal can decide a make-good." },
        { status: 403 }
      ),
    };
  }

  if (mode === "read" && access.role === "none") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Deal not found" }, { status: 404 }),
    };
  }

  return {
    ok: true,
    user,
    deal: access.deal,
    canApprove: access.role === "brand",
  };
}
