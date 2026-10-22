// Brand-scoped show catalog. Discoverable rows, plus shows on this brand's deals.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { listShows } from "@/lib/api/v1/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiRead(async ({ brandId }, req) => {
  const page = await listShows(brandId, req);
  return apiJson({ data: page.data, next_cursor: page.nextCursor }, 200);
});
