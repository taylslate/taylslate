// Campaigns owned by the API key's brand.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { listCampaigns } from "@/lib/api/v1/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiRead(async ({ brandId }, req) => {
  const page = await listCampaigns(brandId, req);
  return apiJson({ data: page.data, next_cursor: page.nextCursor }, 200);
});
