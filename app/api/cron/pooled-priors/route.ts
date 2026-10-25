// GET /api/cron/pooled-priors
// Vercel Cron, daily. Rebuilds the two anonymized prior tables.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// A missing secret, or a request without that bearer token, is 401.
//
// Both refreshes use the service-role client inside the helpers.
// A missing table or function is fail-soft and does not block the other.

import { NextRequest, NextResponse } from "next/server";
import { refreshPooledDealPriors } from "@/lib/learning/pooled-deal-priors";
import { refreshPooledImportPriors } from "@/lib/learning/pooled-priors";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [importPriors, dealPriors] = await Promise.all([
    refreshPooledImportPriors(),
    refreshPooledDealPriors(),
  ]);

  return NextResponse.json({
    import_priors: importPriors,
    deal_priors: dealPriors,
  });
}
