// JSON-RPC 2.0 for the MCP endpoint. Versions 2026-07-28, 2025-11-25,
// and 2025-06-18. No sessions and no server-initiated requests.

import { UnknownToolError, callTool, listTools, type ToolContext } from "@/lib/mcp/tools";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18"] as const;

export const CURRENT_PROTOCOL_VERSION = "2026-07-28";

const LEGACY_VERSIONS = new Set<string>(["2025-11-25", "2025-06-18"]);

const SUPPORTED = new Set<string>(SUPPORTED_PROTOCOL_VERSIONS);

const MODERN_METHODS = new Set(["server/discover", "ping", "tools/list", "tools/call"]);

const LEGACY_METHODS = new Set(["initialize", "ping", "tools/list", "tools/call"]);

const VERSION_META = "io.modelcontextprotocol/protocolVersion";

const SERVER_INFO = { name: "taylslate", version: "1.0.0" };

const CAPABILITIES = { tools: {} };

const INSTRUCTIONS =
  "Taylslate reads this brand's shows, campaigns, scores, plans, deals, and pending actions. propose_campaign and propose_outreach only record a pending action the brand approves in Taylslate. Nothing is sent, created, or charged.";

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;

export interface McpHeaderInput {
  protocolVersion: string | null;
  method: string | null;
  name: string | null;
}

export interface McpDispatch {
  status: number;
  body: unknown | null;
  method: string | null;
  tool: string | null;
  outcome: number;
}

export async function handleMcpMessage(
  payload: unknown,
  headers: McpHeaderInput,
  ctx: ToolContext
): Promise<McpDispatch> {
  if (Array.isArray(payload)) {
    return rpcError(400, null, INVALID_REQUEST, "Invalid Request", undefined, null, null);
  }
  if (!isRecord(payload)) {
    return rpcError(400, null, INVALID_REQUEST, "Invalid Request", undefined, null, null);
  }
  if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string" || payload.method.length === 0) {
    return rpcError(400, idOrNull(payload.id), INVALID_REQUEST, "Invalid Request", undefined, null, null);
  }

  const method = payload.method;
  const hasId = Object.prototype.hasOwnProperty.call(payload, "id");
  if (hasId && !validId(payload.id)) {
    return rpcError(400, null, INVALID_REQUEST, "Invalid Request", undefined, method, null);
  }
  const id = hasId ? (payload.id as string | number | null) : undefined;

  if (payload.params !== undefined && !isRecord(payload.params)) {
    return rpcError(400, id ?? null, INVALID_PARAMS, "Invalid params", undefined, method, null);
  }
  const params = isRecord(payload.params) ? payload.params : {};

  const negotiated = negotiate(method, params, headers, id);
  if (!negotiated.ok) return negotiated.result;
  const version = negotiated.version;

  if (!hasId) {
    return { status: 202, body: null, method, tool: null, outcome: 202 };
  }

  const modern = version === CURRENT_PROTOCOL_VERSION;
  const allowed = modern ? MODERN_METHODS : LEGACY_METHODS;
  if (!allowed.has(method)) {
    return rpcError(404, id ?? null, METHOD_NOT_FOUND, "Method not found", undefined, method, null);
  }

  try {
    if (method === "ping") {
      const result = modern ? { resultType: "complete" } : {};
      return rpcOk(id ?? null, result, method, null, 200);
    }
    if (method === "initialize") {
      return rpcOk(
        id ?? null,
        {
          protocolVersion: version,
          capabilities: CAPABILITIES,
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
        method,
        null,
        200
      );
    }
    if (method === "server/discover") {
      return rpcOk(
        id ?? null,
        {
          resultType: "complete",
          supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
          capabilities: CAPABILITIES,
          _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
          instructions: INSTRUCTIONS,
        },
        method,
        null,
        200
      );
    }
    if (method === "tools/list") {
      return listResult(id ?? null, params, version, method, ctx);
    }
    return await callResult(id ?? null, params, version, method, ctx);
  } catch {
    return rpcError(500, id ?? null, INTERNAL_ERROR, "MCP request failed.", undefined, method, null);
  }
}

function listResult(
  id: string | number | null,
  params: Record<string, unknown>,
  version: string,
  method: string,
  ctx: ToolContext
): McpDispatch {
  if (!onlyKeys(params, ["cursor", "_meta"])) {
    return rpcError(400, id, INVALID_PARAMS, "Invalid params", undefined, method, null);
  }
  if (params.cursor != null && params.cursor !== "") {
    return rpcError(400, id, INVALID_PARAMS, "Invalid params", undefined, method, null);
  }
  const result: Record<string, unknown> = { tools: listTools(ctx.scopes) };
  if (version === CURRENT_PROTOCOL_VERSION) result.resultType = "complete";
  return rpcOk(id, result, method, null, 200);
}

async function callResult(
  id: string | number | null,
  params: Record<string, unknown>,
  version: string,
  method: string,
  ctx: ToolContext
): Promise<McpDispatch> {
  if (!onlyKeys(params, ["name", "arguments", "_meta"])) {
    return rpcError(400, id, INVALID_PARAMS, "Invalid params", undefined, method, null);
  }
  if (typeof params.name !== "string" || params.name.length === 0) {
    return rpcError(400, id, INVALID_PARAMS, "Invalid params", undefined, method, null);
  }
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!isRecord(args)) {
    return rpcError(400, id, INVALID_PARAMS, "Invalid params", undefined, method, null);
  }
  const tool = params.name;
  try {
    const called = await callTool(ctx, tool, args);
    const result: Record<string, unknown> = {
      content: called.content,
      structuredContent: called.structuredContent,
      isError: called.isError,
    };
    if (version === CURRENT_PROTOCOL_VERSION) result.resultType = "complete";
    const outcome = toolOutcome(called.isError, called.structuredContent);
    return rpcOk(id, result, method, tool, outcome);
  } catch (err) {
    if (err instanceof UnknownToolError) {
      return rpcError(400, id, INVALID_PARAMS, "Invalid params", undefined, method, null);
    }
    return rpcError(500, id, INTERNAL_ERROR, "MCP request failed.", undefined, method, safeTool(tool));
  }
}

function toolOutcome(isError: boolean, structured: unknown): number {
  if (!isError) return 200;
  if (!isRecord(structured) || typeof structured.status !== "number") return 200;
  return structured.status;
}

type Negotiated = { ok: true; version: string } | { ok: false; result: McpDispatch };

function negotiate(
  method: string,
  params: Record<string, unknown>,
  headers: McpHeaderInput,
  id: string | number | null | undefined
): Negotiated {
  const replyId = id;
  if (method === "initialize" && (typeof params.protocolVersion !== "string" || params.protocolVersion.length === 0)) {
    return {
      ok: false,
      result: rpcError(400, replyId, INVALID_PARAMS, "Invalid params", undefined, method, null),
    };
  }
  const header = headers.protocolVersion;
  const meta = metaVersion(params);
  const initVersion =
    method === "initialize" && typeof params.protocolVersion === "string" ? params.protocolVersion : null;

  if (header && !SUPPORTED.has(header)) {
    return { ok: false, result: unsupported(replyId, header, method) };
  }
  if (meta && !SUPPORTED.has(meta)) {
    return { ok: false, result: unsupported(replyId, meta, method) };
  }
  if (initVersion && !SUPPORTED.has(initVersion)) {
    return { ok: false, result: unsupported(replyId, initVersion, method) };
  }
  if (header && meta && header !== meta) {
    return { ok: false, result: mismatch(replyId, method) };
  }
  if (header && initVersion && header !== initVersion) {
    return { ok: false, result: mismatch(replyId, method) };
  }
  if (meta && initVersion && meta !== initVersion) {
    return { ok: false, result: mismatch(replyId, method) };
  }

  let version: string | null = null;
  if (header && SUPPORTED.has(header)) version = header;
  else if (meta && SUPPORTED.has(meta)) version = meta;
  else if (initVersion && LEGACY_VERSIONS.has(initVersion)) version = initVersion;

  if (!version) {
    if (method === "initialize") {
      return {
        ok: false,
        result: rpcError(400, replyId, INVALID_PARAMS, "Invalid params", undefined, method, null),
      };
    }
    return { ok: false, result: mismatch(replyId, method) };
  }

  if (version === CURRENT_PROTOCOL_VERSION) {
    if (header !== version || meta !== version) {
      return { ok: false, result: mismatch(replyId, method) };
    }
    const methodHeader = decodeHeader(headers.method);
    if (methodHeader == null || methodHeader !== method) {
      return { ok: false, result: mismatch(replyId, method) };
    }
    if (method === "tools/call") {
      const name = typeof params.name === "string" ? params.name : "";
      const nameHeader = decodeHeader(headers.name);
      if (!name || nameHeader == null || nameHeader !== name) {
        return { ok: false, result: mismatch(replyId, method) };
      }
    }
  }

  if (method === "initialize" && !onlyKeys(params, ["protocolVersion", "capabilities", "clientInfo", "_meta"])) {
    return {
      ok: false,
      result: rpcError(400, replyId, INVALID_PARAMS, "Invalid params", undefined, method, null),
    };
  }
  if (method === "ping" && !onlyKeys(params, ["_meta"])) {
    return {
      ok: false,
      result: rpcError(400, replyId, INVALID_PARAMS, "Invalid params", undefined, method, null),
    };
  }
  if (method === "server/discover" && !onlyKeys(params, ["_meta"])) {
    return {
      ok: false,
      result: rpcError(400, replyId, INVALID_PARAMS, "Invalid params", undefined, method, null),
    };
  }

  return { ok: true, version };
}

function metaVersion(params: Record<string, unknown>): string | null {
  if (!isRecord(params._meta)) return null;
  const value = params._meta[VERSION_META];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function decodeHeader(raw: string | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const match = /^=\?base64\?([A-Za-z0-9+/]+={0,2})\?=$/.exec(trimmed);
  if (!match) {
    if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null;
    return trimmed;
  }
  try {
    return Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
}

function unsupported(id: string | number | null | undefined, requested: string, method: string): McpDispatch {
  return rpcError(
    400,
    id,
    UNSUPPORTED_VERSION,
    "Unsupported protocol version",
    {
      supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      requested: requestedLabel(requested),
    },
    method,
    null
  );
}

function mismatch(id: string | number | null | undefined, method: string): McpDispatch {
  return rpcError(400, id, HEADER_MISMATCH, "Header mismatch", undefined, method, null);
}

function requestedLabel(value: string): string {
  if (value.length === 0 || value.length > 64 || /[^\x20-\x7E]/.test(value)) return "invalid";
  return value;
}

function rpcOk(
  id: string | number | null,
  result: unknown,
  method: string,
  tool: string | null,
  outcome: number
): McpDispatch {
  return {
    status: 200,
    body: { jsonrpc: "2.0", id, result },
    method,
    tool: safeTool(tool),
    outcome,
  };
}

function rpcError(
  status: number,
  id: string | number | null | undefined,
  code: number,
  message: string,
  data: unknown,
  method: string | null,
  tool: string | null
): McpDispatch {
  const error: Record<string, unknown> = { code, message };
  if (data !== undefined) error.data = data;
  const body: Record<string, unknown> = { jsonrpc: "2.0", error };
  if (id !== undefined) body.id = id;
  return {
    status,
    body,
    method,
    tool: safeTool(tool),
    outcome: status,
  };
}

function safeTool(tool: string | null): string | null {
  if (!tool || !/^[a-z0-9_]{1,64}$/.test(tool)) return null;
  return tool;
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return false;
  }
  return true;
}

function idOrNull(id: unknown): string | number | null {
  return validId(id) ? id : null;
}

function validId(id: unknown): id is string | number | null {
  if (id === null) return true;
  if (typeof id === "string") return true;
  if (typeof id === "number" && Number.isFinite(id)) return true;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
