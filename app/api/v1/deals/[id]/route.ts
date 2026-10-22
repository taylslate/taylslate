// One deal. A deal owned by another brand is 404.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { getDeal } from "@/lib/api/v1/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DealRoute = { params: Promise<{ id: string }> };

export const GET = withApiRead<DealRoute>(async ({ brandId }, _req, route) => {
  const { id } = await route.params;
  return apiJson({ data: await getDeal(brandId, id) }, 200);
});
