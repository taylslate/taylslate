// One recorded write action for this brand. Another brand's id is 404.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { getWriteAction } from "@/lib/api/v1/writes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ActionRoute = { params: Promise<{ id: string }> };

export const GET = withApiRead<ActionRoute>(async ({ brandId }, _req, route) => {
  const { id } = await route.params;
  return apiJson({ data: await getWriteAction(brandId, id) }, 200);
});
