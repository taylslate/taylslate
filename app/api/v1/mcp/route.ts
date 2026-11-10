// MCP Streamable HTTP endpoint. JSON responses only. One JSON-RPC
// message per POST. Auth, rate limit, and body limits match /api/v1.

import { ApiAuthError, resolveApiRequest } from "@/lib/api/auth";
import type { ApiScope } from "@/lib/api/keys";
import { enforceApiRateLimit } from "@/lib/api/rate-limit";
import { API_WRITE_MAX_BODY_BYTES, ApiWriteError, apiJson } from "@/lib/api/v1/handler";
import { handleMcpMessage, type McpDispatch } from "@/lib/mcp/protocol";
import { isMcpToolName, type ToolContext } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_METHOD =
  /^(initialize|server\/discover|ping|tools\/list|tools\/call|notifications\/[a-z0-9_-]{1,40})$/;

export async function POST(req: Request): Promise<Response> {
  const started = Date.now();
  try {
    if (!originAllowed(req)) {
      return finish(started, null, null, 403, originDenied());
    }
    const resolved = await resolveApiRequest(req);
    const limit = await enforceApiRateLimit(resolved.keyId);
    if (!limit.ok) {
      return finish(
        started,
        null,
        null,
        429,
        apiJson({ error: "Rate limit exceeded." }, 429, {
          "Retry-After": String(limit.retryAfterSec),
        })
      );
    }
    const bytes = await readLimitedBody(req);
    const mime = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (mime !== "application/json") {
      throw new ApiWriteError(415, "Request body must be JSON.");
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiWriteError(415, "Request body must be JSON.");
    }
    const ctx: ToolContext = {
      brandId: resolved.brandId,
      keyId: resolved.keyId,
      scopes: resolved.scopes as ApiScope[],
    };
    const dispatch = await handleMcpMessage(payload, readProtocolHeaders(req), ctx);
    return finish(started, dispatch.method, dispatch.tool, dispatch.outcome, toResponse(dispatch));
  } catch (err) {
    if (err instanceof ApiAuthError) {
      const extra = err.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined;
      return finish(started, null, null, err.status, apiJson({ error: err.message }, err.status, extra));
    }
    if (err instanceof ApiWriteError) {
      return finish(started, null, null, err.status, apiJson({ error: err.message }, err.status));
    }
    return finish(started, null, null, 500, apiJson({ error: "API request failed." }, 500));
  }
}

export function GET(): Response {
  return methodNotAllowed();
}

export function PUT(): Response {
  return methodNotAllowed();
}

export function PATCH(): Response {
  return methodNotAllowed();
}

export function DELETE(): Response {
  return methodNotAllowed();
}

function methodNotAllowed(): Response {
  const started = Date.now();
  return finish(started, null, null, 405, apiJson({ error: "Method not allowed." }, 405, { Allow: "POST" }));
}

function originDenied(): Response {
  return apiJson(
    {
      jsonrpc: "2.0",
      error: { code: -32600, message: "Origin is not allowed." },
    },
    403
  );
}

function toResponse(dispatch: McpDispatch): Response {
  if (dispatch.body == null) {
    return new Response(null, {
      status: dispatch.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return apiJson(dispatch.body, dispatch.status);
}

function finish(
  started: number,
  method: string | null,
  tool: string | null,
  outcome: number,
  response: Response
): Response {
  const safeMethod = method && SAFE_METHOD.test(method) ? method : "-";
  const safeTool = tool && isMcpToolName(tool) ? tool : "-";
  console.info(
    `[mcp] method=${safeMethod} tool=${safeTool} outcome=${outcome} elapsed_ms=${Date.now() - started}`
  );
  return response;
}

function readProtocolHeaders(req: Request): { protocolVersion: string | null; method: string | null; name: string | null } {
  return {
    protocolVersion: headerValue(req, "mcp-protocol-version"),
    method: headerValue(req, "mcp-method"),
    name: headerValue(req, "mcp-name"),
  };
}

function headerValue(req: Request, name: string): string | null {
  const value = req.headers.get(name);
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin == null || origin.trim() === "") return true;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  if (!originHost) return false;
  return originHost.toLowerCase() === requestHost(req).toLowerCase();
}

function requestHost(req: Request): string {
  const host = req.headers.get("host");
  if (host && host.trim() !== "") return host.trim();
  try {
    return new URL(req.url).host;
  } catch {
    return "";
  }
}

async function readLimitedBody(req: Request): Promise<Uint8Array> {
  const stream = req.body;
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > API_WRITE_MAX_BODY_BYTES) {
        throw new ApiWriteError(413, "Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
