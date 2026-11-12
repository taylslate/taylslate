// Protected resource metadata. No database access.

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

export function GET(): Response {
  try {
    requireSiteOrigin();
    const document = protectedResourceMetadata();
    if (!document) return respondOauthFailure(new Error("origin"), true);
    return metadataJson(document);
  } catch (err) {
    return respondOauthFailure(err, true);
  }
}
