// Brand-scoped show catalog. Discoverable rows, plus shows on this brand's deals.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { listShows } from "@/lib/api/v1/reads";
import { fullShowIdsForCaller, projectShows } from "@/lib/shows/public-fields";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiRead(async ({ brandId }, req) => {
  const page = await listShows(brandId, req);
  const fullIds = await fullShowIdsForCaller(brandId, page.data);
  return apiJson(
    { data: projectShows(page.data, fullIds), next_cursor: page.nextCursor },
    200
  );
});
