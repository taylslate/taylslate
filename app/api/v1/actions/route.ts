// This brand's recorded write actions. Read only.

import { apiJson, withApiRead } from "@/lib/api/v1/handler";
import { listWriteActions } from "@/lib/api/v1/writes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiRead(async ({ brandId }, req) => {
  const page = await listWriteActions(brandId, req);
  return apiJson({ data: page.data, next_cursor: page.nextCursor }, 200);
});
