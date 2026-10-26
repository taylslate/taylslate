// POST records a pending outreach.draft. It does not send outreach.

import { apiJson, withApiWrite } from "@/lib/api/v1/handler";
import { recordOutreachDraft } from "@/lib/api/v1/writes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApiWrite("write:outreach", async (ctx) => {
  const recorded = await recordOutreachDraft(ctx);
  return apiJson(
    { action_id: recorded.actionId, status: recorded.status },
    recorded.replay ? 200 : 202
  );
});
