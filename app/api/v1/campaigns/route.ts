// Campaigns owned by the API key's brand.
// POST records a pending campaign.create. It does not create a campaign.

import { apiJson, withApiRead, withApiWrite } from "@/lib/api/v1/handler";
import { listCampaigns } from "@/lib/api/v1/reads";
import { recordCampaignCreate } from "@/lib/api/v1/writes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiRead(async ({ brandId }, req) => {
  const page = await listCampaigns(brandId, req);
  return apiJson({ data: page.data, next_cursor: page.nextCursor }, 200);
});

export const POST = withApiWrite("write:campaigns", async (ctx) => {
  const recorded = await recordCampaignCreate(ctx);
  return apiJson(
    { action_id: recorded.actionId, status: recorded.status },
    recorded.replay ? 200 : 202
  );
});
