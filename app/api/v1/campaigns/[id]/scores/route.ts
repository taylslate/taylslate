// Conviction scores for a campaign this brand owns.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { listScores } from "@/lib/api/v1/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ScoresRoute = { params: Promise<{ id: string }> };

export const GET = withApiRead<ScoresRoute>(async ({ brandId }, req, route) => {
  const { id } = await route.params;
  const page = await listScores(brandId, id, req);
  return apiJson({ data: page.data, next_cursor: page.nextCursor }, 200);
});
