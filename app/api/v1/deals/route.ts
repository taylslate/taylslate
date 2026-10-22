// Deals for this brand, including Wave 12 rows tied by brand profile.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { listDeals } from "@/lib/api/v1/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiRead(async ({ brandId }, req) => {
  const page = await listDeals(brandId, req);
  return apiJson({ data: page.data, next_cursor: page.nextCursor }, 200);
});
