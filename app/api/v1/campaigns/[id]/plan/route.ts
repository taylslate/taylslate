// Media plan for a campaign this brand owns. Null when no plan is saved.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { getPlan } from "@/lib/api/v1/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PlanRoute = { params: Promise<{ id: string }> };

export const GET = withApiRead<PlanRoute>(async ({ brandId }, _req, route) => {
  const { id } = await route.params;
  return apiJson({ data: await getPlan(brandId, id) }, 200);
});
