// One visible show. Another brand's private row is 404.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { getShow } from "@/lib/api/v1/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ShowRoute = { params: Promise<{ id: string }> };

export const GET = withApiRead<ShowRoute>(async ({ brandId }, _req, route) => {
  const { id } = await route.params;
  return apiJson({ data: await getShow(brandId, id) }, 200);
});
