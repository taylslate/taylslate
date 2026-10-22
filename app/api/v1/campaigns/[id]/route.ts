// One campaign. A campaign owned by another brand is 404.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { getCampaign } from "@/lib/api/v1/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CampaignRoute = { params: Promise<{ id: string }> };

export const GET = withApiRead<CampaignRoute>(async ({ brandId }, _req, route) => {
  const { id } = await route.params;
  return apiJson({ data: await getCampaign(brandId, id) }, 200);
});
