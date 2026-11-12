// Authorization server metadata (RFC 8414). No database access.

import {
  authorizationServerMetadata,
  metadataJson,
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
    const document = authorizationServerMetadata();
    if (!document) return respondOauthFailure(new Error("origin"), true);
    return metadataJson(document);
  } catch (err) {
    return respondOauthFailure(err, true);
  }
}
