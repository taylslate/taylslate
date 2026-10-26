// Shared wrappers for /api/v1. Reads and writes use the same auth and
// rate limit order as GET /api/v1/health. A missing object is 404,
// including one that belongs to another brand. Writes record a pending
// action. They do not execute it.

import { NextResponse } from "next/server";
import { ApiAuthError, requireScope, resolveApiRequest } from "@/lib/api/auth";
import type { ApiScope } from "@/lib/api/keys";
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

export class ApiWriteError extends Error {
  readonly status: 400 | 404 | 409 | 413 | 415 | 422;

  constructor(status: 400 | 404 | 409 | 413 | 415 | 422, message: string) {
    super(message);
    this.name = "ApiWriteError";
    this.status = status;
  }
}

export const API_WRITE_MAX_BODY_BYTES = 64 * 1024;

const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,128}$/;

export interface ApiWriteContext {
  brandId: string;
  keyId: string;
  idempotencyKey: string;
  body: unknown;
}

export function withApiWrite<Route = EmptyRoute>(
  scope: ApiScope,
  handler: (ctx: ApiWriteContext, req: Request, route: Route) => Promise<Response>
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
      requireScope(resolved, scope);
      const idempotencyKey = readIdempotencyKey(req);
      const body = await readJsonBody(req);
      const response = await handler(
        {
          brandId: resolved.brandId,
          keyId: resolved.keyId,
          idempotencyKey,
          body,
        },
        req,
        route
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch (err) {
      if (
        err instanceof ApiAuthError ||
        err instanceof ApiReadError ||
        err instanceof ApiWriteError
      ) {
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

function readIdempotencyKey(req: Request): string {
  const value = req.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY.test(value)) {
    throw new ApiWriteError(
      400,
      "Idempotency-Key must be 1 to 128 printable characters."
    );
  }
  return value;
}

async function readJsonBody(req: Request): Promise<unknown> {
  const declared = req.headers.get("content-length");
  if (declared != null && declared !== "") {
    if (!/^\d+$/.test(declared) || Number(declared) > API_WRITE_MAX_BODY_BYTES) {
      throw new ApiWriteError(413, "Request body is too large.");
    }
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > API_WRITE_MAX_BODY_BYTES) {
    throw new ApiWriteError(413, "Request body is too large.");
  }
  const mime = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime !== "application/json") {
    throw new ApiWriteError(415, "Request body must be JSON.");
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiWriteError(415, "Request body must be JSON.");
  }
}
