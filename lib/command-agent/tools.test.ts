import { beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_TOOL_NAMES } from "@/lib/mcp/args";

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
}));

vi.mock("@/lib/mcp/tools", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/tools")>("@/lib/mcp/tools");
  return {
    ...actual,
    callTool: (...args: unknown[]) => mocks.callTool(...args),
  };
});

import { RESULT_TEXT_LIMIT } from "@/lib/command-agent/limits";
import {
  agentToolDefinitions,
  agentToolNames,
  dispatchAgentTool,
  sanitizeArgs,
  serverIdempotencyKey,
  withServerIdempotency,
  wrapToolResultText,
} from "@/lib/command-agent/tools";

const BRAND = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

beforeEach(() => {
  mocks.callTool.mockReset();
  mocks.callTool.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify({ data: [] }) }],
    structuredContent: { data: [] },
    isError: false,
  });
});

describe("command agent tools", () => {
  it("exposes exactly the M1 registry names", () => {
    expect(agentToolNames()).toEqual([...MCP_TOOL_NAMES]);
    expect(agentToolDefinitions().map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
  });

  it("overwrites a propose idempotency key with the server value", () => {
    const args = withServerIdempotency(
      "propose_campaign",
      { idempotency_key: "caller-key", goals: ["test_channel"], budget_total: 25000 },
      MESSAGE,
      1
    );
    expect(args).toMatchObject({ idempotency_key: serverIdempotencyKey(MESSAGE, 1) });
    expect((args as { idempotency_key: string }).idempotency_key).toBe(`ca:${MESSAGE}:1`);
  });

  it("wraps tool text as data and marks truncation at 16000 characters", () => {
    const short = wrapToolResultText(JSON.stringify({ name: "Visible Show" }));
    expect(JSON.parse(short)).toEqual({ data: { name: "Visible Show" } });
    const long = wrapToolResultText("x".repeat(RESULT_TEXT_LIMIT + 50));
    expect(long.length).toBeLessThanOrEqual(RESULT_TEXT_LIMIT);
    expect(long.endsWith("truncated")).toBe(true);
  });

  it("drops secret-like argument keys before storage", () => {
    expect(sanitizeArgs({ show_id: "abc", api_key: "secret", nested: { token: "t", name: "Show" } })).toEqual({
      show_id: "abc",
      nested: { name: "Show" },
    });
  });

  it("refuses an unknown tool without calling callTool", async () => {
    const result = await dispatchAgentTool({
      brandId: BRAND,
      name: "approve_action",
      args: {},
      userMessageId: MESSAGE,
      proposeOrdinal: 1,
    });
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.toolResultText).toBe("Unknown tool.");
  });

  it("calls callTool with the session brand even when the model sends a brand id", async () => {
    await dispatchAgentTool({
      brandId: BRAND,
      name: "get_show",
      args: { id: MESSAGE, brand_id: "22222222-2222-4222-8222-222222222222", user_id: "nope" },
      userMessageId: MESSAGE,
      proposeOrdinal: 0,
    });
    expect(mocks.callTool).toHaveBeenCalledWith(
      {
        brandId: BRAND,
        keyId: null,
        source: "command_agent",
        scopes: ["read", "write:campaigns", "write:outreach"],
      },
      "get_show",
      { id: MESSAGE, brand_id: "22222222-2222-4222-8222-222222222222", user_id: "nope" }
    );
  });

  it("forces the server idempotency key on propose_campaign", async () => {
    mocks.callTool.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ action_id: "act-1", status: "pending" }) }],
      structuredContent: { action_id: "act-1", status: "pending", replayed: false },
      isError: false,
    });
    const result = await dispatchAgentTool({
      brandId: BRAND,
      name: "propose_campaign",
      args: { idempotency_key: "from-the-model", goals: ["test_channel"], budget_total: 25000 },
      userMessageId: MESSAGE,
      proposeOrdinal: 2,
    });
    expect(mocks.callTool.mock.calls[0][2]).toMatchObject({ idempotency_key: `ca:${MESSAGE}:2` });
    expect(result.actionId).toBe("act-1");
    expect(JSON.stringify(result.stored.args)).not.toContain("from-the-model");
  });
});
