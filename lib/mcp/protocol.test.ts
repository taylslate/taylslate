import { describe, expect, it } from "vitest";
import type { ApiScope } from "@/lib/api/keys";
import {
  CURRENT_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  handleMcpMessage,
  type McpHeaderInput,
} from "@/lib/mcp/protocol";
import type { ToolContext } from "@/lib/mcp/tools";

const BRAND = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

function ctx(scopes: ApiScope[]): ToolContext {
  return { brandId: BRAND, keyId: KEY, scopes };
}

function modernHeaders(method: string, name?: string): McpHeaderInput {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    method,
    name: name ?? null,
  };
}

function modernMessage(method: string, params: Record<string, unknown> = {}, id: number | string = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": CURRENT_PROTOCOL_VERSION,
      },
    },
  };
}

describe("MCP protocol", () => {
  it("rejects a batch and accepts a notification", async () => {
    const batch = await handleMcpMessage(
      [modernMessage("ping")],
      modernHeaders("ping"),
      ctx(["read"])
    );
    expect(batch.status).toBe(400);
    expect(batch.body).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600 },
    });

    const note = await handleMcpMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { protocolVersion: "2025-11-25", method: null, name: null },
      ctx(["read"])
    );
    expect(note.status).toBe(202);
    expect(note.body).toBeNull();
  });

  it("returns the unsupported-version error with the versions this server speaks", async () => {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "ping",
        params: {
          _meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" },
        },
      },
      { protocolVersion: "1900-01-01", method: "ping", name: null },
      ctx(["read"])
    );
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      jsonrpc: "2.0",
      id: 4,
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: {
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
          requested: "1900-01-01",
        },
      },
    });
  });

  it("rejects a header that does not match the body", async () => {
    const result = await handleMcpMessage(
      modernMessage("tools/list"),
      { protocolVersion: CURRENT_PROTOCOL_VERSION, method: "ping", name: null },
      ctx(["read"])
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: -32020, message: "Header mismatch" } });
  });

  it("initializes both 2025 versions and discovers the 2026 server", async () => {
    for (const version of ["2025-11-25", "2025-06-18"] as const) {
      const result = await handleMcpMessage(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: version,
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        },
        { protocolVersion: version, method: null, name: null },
        ctx(["read"])
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: 1,
        result: {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: "taylslate", version: "1.0.0" },
        },
      });
      const body = result.body as { result: Record<string, unknown> };
      expect(Object.keys(body.result.capabilities as object)).toEqual(["tools"]);
    }

    const discovered = await handleMcpMessage(
      modernMessage("server/discover"),
      modernHeaders("server/discover"),
      ctx(["read"])
    );
    expect(discovered.status).toBe(200);
    expect(discovered.body).toMatchObject({
      result: {
        resultType: "complete",
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: { tools: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "taylslate", version: "1.0.0" } },
      },
    });
  });

  it("lists tools per version and filters them by scope", async () => {
    const modern = await handleMcpMessage(
      modernMessage("tools/list"),
      modernHeaders("tools/list"),
      ctx(["read"])
    );
    const modernResult = (modern.body as { result: { resultType: string; tools: { name: string }[] } }).result;
    expect(modernResult.resultType).toBe("complete");
    expect(modernResult.tools.map((tool) => tool.name)).not.toContain("propose_campaign");
    expect(modernResult.tools.map((tool) => tool.name)).toContain("list_shows");

    const legacy = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { protocolVersion: "2025-06-18", method: null, name: null },
      ctx(["read", "write:campaigns", "write:outreach"])
    );
    const legacyResult = (legacy.body as { result: { tools: { name: string }[]; resultType?: string } }).result;
    expect(legacyResult.resultType).toBeUndefined();
    expect(legacyResult.tools.map((tool) => tool.name)).toEqual([
      "list_shows",
      "get_show",
      "list_campaigns",
      "get_campaign",
      "list_campaign_scores",
      "get_campaign_plan",
      "list_deals",
      "get_deal",
      "list_actions",
      "get_action",
      "propose_campaign",
      "propose_outreach",
    ]);
  });

  it("maps a missing scope to a tool error and an unknown method to -32601", async () => {
    const denied = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "propose_campaign", arguments: {} },
      },
      { protocolVersion: "2025-11-25", method: null, name: null },
      ctx(["read"])
    );
    expect(denied.status).toBe(200);
    expect(denied.outcome).toBe(403);
    expect(denied.body).toMatchObject({
      result: {
        isError: true,
        structuredContent: { error: "API key lacks the required scope.", status: 403 },
      },
    });

    const missing = await handleMcpMessage(
      { jsonrpc: "2.0", id: 8, method: "resources/list", params: {} },
      { protocolVersion: "2025-11-25", method: null, name: null },
      ctx(["read"])
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: -32601, message: "Method not found" } });

    const bad = await handleMcpMessage(
      modernMessage("tools/call", { name: "list_shows", arguments: [] }),
      modernHeaders("tools/call", "list_shows"),
      ctx(["read"])
    );
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: { code: -32602 } });
  });

  it("answers ping on the current version and on a 2025 version", async () => {
    const current = await handleMcpMessage(modernMessage("ping"), modernHeaders("ping"), ctx(["read"]));
    expect(current.body).toMatchObject({ result: { resultType: "complete" } });

    const legacy = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { protocolVersion: "2025-11-25", method: null, name: null },
      ctx(["read"])
    );
    expect((legacy.body as { result: unknown }).result).toEqual({});
  });
});
