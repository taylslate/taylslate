// Suffix form: /.well-known/oauth-protected-resource/api/v1/mcp
// Any other suffix is 404. No database access.

import {
  metadataJson,
  protectedResourceMetadata,
  requireSiteOrigin,
} from "@/lib/mcp-oauth/config";
import { corsPreflight, respondOauthFailure } from "@/lib/mcp-oauth/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS(): Response {
  return corsPreflight("GET, OPTIONS");
}

export function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return ctx.params.then(({ path }) => {
    if (path.join("/") !== "api/v1/mcp") {
      return new Response(null, { status: 404 });
    }
    try {
      requireSiteOrigin();
      const document = protectedResourceMetadata();
      if (!document) return respondOauthFailure(new Error("origin"), true);
      return metadataJson(document);
    } catch (err) {
      return respondOauthFailure(err, true);
    }
  });
}
