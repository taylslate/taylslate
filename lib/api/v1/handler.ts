// Shared read wrapper for /api/v1. Same auth, rate limit, and scope
// order as GET /api/v1/health. A missing object is 404, including one
// that belongs to another brand.

import { NextResponse } from "next/server";
import { ApiAuthError, requireScope, resolveApiRequest } from "@/lib/api/auth";
import { enforceApiRateLimit } from "@/lib/api/rate-limit";

export interface ApiReadContext {
  brandId: string;
}

export class ApiReadError extends Error {
  readonly status: 400 | 404;

  constructor(status: 400 | 404, message: string) {
    super(message);
    this.name = "ApiReadError";
    this.status = status;
  }
}

export function apiJson(
  body: unknown,
  status: number,
  extra?: Record<string, string>
): Response {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      headers.set(key, value);
    }
  }
  return NextResponse.json(body, { status, headers });
}

type EmptyRoute = { params: Promise<Record<string, never>> };

export function withApiRead<Route = EmptyRoute>(
  handler: (ctx: ApiReadContext, req: Request, route: Route) => Promise<Response>
): (req: Request, route: Route) => Promise<Response> {
  return async (req: Request, route: Route): Promise<Response> => {
    try {
      const resolved = await resolveApiRequest(req);
      const limit = await enforceApiRateLimit(resolved.keyId);
      if (!limit.ok) {
        return apiJson({ error: "Rate limit exceeded." }, 429, {
          "Retry-After": String(limit.retryAfterSec),
        });
      }
      requireScope(resolved, "read");
      const response = await handler({ brandId: resolved.brandId }, req, route);
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch (err) {
      if (err instanceof ApiAuthError || err instanceof ApiReadError) {
        return apiJson({ error: err.message }, err.status);
      }
      console.warn(
        "[api.v1] failed:",
        err instanceof Error ? err.name : "unknown"
      );
      return apiJson({ error: "API request failed." }, 500);
    }
  };
}
