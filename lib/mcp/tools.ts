// Tool registry for the MCP endpoint and for in-process callers.
// Each handler calls an existing /api/v1 function. brandId comes from
// the caller context, never from arguments.

import type { ApiScope } from "@/lib/api/keys";
import { ApiReadError, ApiWriteError } from "@/lib/api/v1/handler";
import {
  getCampaign,
  getDeal,
  getPlan,
  getShow,
  listCampaigns,
  listDeals,
  listScores,
  listShows,
} from "@/lib/api/v1/reads";
import {
  getWriteAction,
  listWriteActions,
  recordCampaignCreate,
  recordOutreachDraft,
} from "@/lib/api/v1/writes";
import { fullShowIdsForCaller, projectShows } from "@/lib/shows/public-fields";
import {
  UnknownToolError,
  isMcpToolName,
  validateToolArguments,
  type McpToolName,
  type ValidatedArgs,
} from "@/lib/mcp/args";

export { UnknownToolError, isMcpToolName };
export type { McpToolName };

export interface ToolContext {
  brandId: string;
  keyId: string | null;
  scopes: readonly ApiScope[];
  source?: "api_key" | "command_agent";
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: unknown;
  isError: boolean;
}

export interface PublicTool {
  name: McpToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ToolDef {
  name: McpToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: ApiScope;
  handler: (ctx: ToolContext, args: ValidatedArgs) => Promise<unknown>;
}

const PENDING =
  "This only records a pending action the brand approves in Taylslate. Nothing is sent, created, or charged.";

const cursorProp = {
  type: "string",
  maxLength: 512,
  description: "Opaque cursor returned as next_cursor on the previous page.",
};

const limitProp = {
  type: "integer",
  minimum: 1,
  maximum: 100,
  description: "Page size. Defaults to 25. Values above 100 are clamped to 100.",
};

const idempotencyProp = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  description: "1 to 128 printable ASCII characters. The same key and payload returns the same action.",
};

function listSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: { cursor: cursorProp, limit: limitProp },
  };
}

function idSchema(description: string): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid", description },
    },
  };
}

function scoreSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid", description: "Campaign id." },
      cursor: cursorProp,
      limit: limitProp,
    },
  };
}

const campaignSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["goals", "budget_total", "flight", "idempotency_key"],
  properties: {
    idempotency_key: idempotencyProp,
    product: {
      type: "object",
      additionalProperties: false,
      properties: {
        brand_name: { type: "string" },
        category: { type: "string" },
        product_description: { type: "string" },
        aov_bucket: { type: "string", enum: ["low", "mid", "high"] },
        aov_reasoning: { type: "string" },
        key_attributes: { type: "array", items: { type: "string" } },
        source: { type: "string", enum: ["url", "paragraph"] },
        url: { type: ["string", "null"] },
      },
    },
    customer_text: { type: "string" },
    customer_context: {
      type: "object",
      additionalProperties: false,
      required: ["reused_from_pattern_id"],
      properties: {
        reused_from_pattern_id: { type: "string", format: "uuid" },
        delta_text: { type: "string" },
        product_url: { type: ["string", "null"] },
        changed_fields: { type: "object" },
        product_attributes: { type: "object" },
      },
    },
    goals: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "string",
        enum: ["test_channel", "scale_winner", "direct_response", "brand_awareness", "lead_gen"],
      },
    },
    goals_context: { type: "string" },
    budget_total: { type: "number", minimum: 5000 },
    flight: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["preset", "dates"] },
        preset: {
          type: "string",
          enum: ["asap", "next_30_days", "next_60_days", "next_quarter"],
        },
        start_date: { type: "string" },
        end_date: { type: "string" },
      },
    },
    exclusions_text: { type: "string" },
  },
};

const outreachSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["show_id", "subject", "body", "idempotency_key"],
  properties: {
    idempotency_key: idempotencyProp,
    show_id: { type: "string", format: "uuid", description: "Show to draft outreach for." },
    subject: { type: "string", minLength: 1, maxLength: 200 },
    body: { type: "string", minLength: 30, maxLength: 5000 },
  },
};

const registry: readonly ToolDef[] = [
  {
    name: "list_shows",
    title: "List shows",
    description:
      "List shows visible to this brand. A discoverable show is included. A private show is included only when this brand has a deal for it. Contact and rates are included only when this brand is tied to the show.",
    inputSchema: listSchema(),
    scope: "read",
    handler: listShowsTool,
  },
  {
    name: "get_show",
    title: "Get show",
    description:
      "Read one show visible to this brand. A private show owned by another brand is not found. Contact and rates are included only when this brand is tied to the show.",
    inputSchema: idSchema("Show id."),
    scope: "read",
    handler: getShowTool,
  },
  {
    name: "list_campaigns",
    title: "List campaigns",
    description: "List campaigns owned by this brand.",
    inputSchema: listSchema(),
    scope: "read",
    handler: listCampaignsTool,
  },
  {
    name: "get_campaign",
    title: "Get campaign",
    description: "Read one campaign owned by this brand.",
    inputSchema: idSchema("Campaign id."),
    scope: "read",
    handler: getCampaignTool,
  },
  {
    name: "list_campaign_scores",
    title: "List campaign scores",
    description: "List conviction scores for one campaign owned by this brand.",
    inputSchema: scoreSchema(),
    scope: "read",
    handler: listScoresTool,
  },
  {
    name: "get_campaign_plan",
    title: "Get campaign plan",
    description: "Read the media plan for one campaign owned by this brand. The plan is null when none is saved.",
    inputSchema: idSchema("Campaign id."),
    scope: "read",
    handler: getPlanTool,
  },
  {
    name: "list_deals",
    title: "List deals",
    description: "List deals for this brand.",
    inputSchema: listSchema(),
    scope: "read",
    handler: listDealsTool,
  },
  {
    name: "get_deal",
    title: "Get deal",
    description: "Read one deal for this brand.",
    inputSchema: idSchema("Deal id."),
    scope: "read",
    handler: getDealTool,
  },
  {
    name: "list_actions",
    title: "List actions",
    description:
      "List write actions recorded for this brand. Listing does not approve, send, or charge anything.",
    inputSchema: listSchema(),
    scope: "read",
    handler: listActionsTool,
  },
  {
    name: "get_action",
    title: "Get action",
    description: "Read one write action recorded for this brand.",
    inputSchema: idSchema("Action id."),
    scope: "read",
    handler: getActionTool,
  },
  {
    name: "propose_campaign",
    title: "Propose campaign",
    description: `Record a pending campaign. ${PENDING}`,
    inputSchema: campaignSchema,
    scope: "write:campaigns",
    handler: proposeCampaignTool,
  },
  {
    name: "propose_outreach",
    title: "Propose outreach",
    description: `Record a pending outreach draft. ${PENDING}`,
    inputSchema: outreachSchema,
    scope: "write:outreach",
    handler: proposeOutreachTool,
  },
];

export function listTools(scopes: readonly ApiScope[]): PublicTool[] {
  const tools: PublicTool[] = [];
  for (const tool of registry) {
    if (!scopes.includes(tool.scope)) continue;
    tools.push({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
  }
  return tools;
}

// In-process entry for the command agent. Same scope check and argument
// checks as POST /api/v1/mcp. The caller supplies brandId from its own
// session. Arguments cannot name a brand, user, or key.
export async function callTool(ctx: ToolContext, name: string, args: unknown): Promise<ToolResult> {
  const tool = registry.find((item) => item.name === name);
  if (!tool) throw new UnknownToolError();
  if (!ctx.scopes.includes(tool.scope)) {
    return toolError(403, "API key lacks the required scope.");
  }
  try {
    const validated = validateToolArguments(name, args ?? {});
    const data = await tool.handler(ctx, validated);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
      isError: false,
    };
  } catch (err) {
    if (err instanceof ApiReadError || err instanceof ApiWriteError) {
      return toolError(err.status, err.message);
    }
    throw err;
  }
}

function toolError(status: number, message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message, status },
    isError: true,
  };
}

// Query carrier for the v1 list helpers. This is not the client HTTP request.
function pageRequest(cursor?: string, limit?: number): Request {
  const url = new URL("https://www.taylslate.com/api/v1/mcp");
  if (cursor) url.searchParams.set("cursor", cursor);
  if (limit != null) url.searchParams.set("limit", String(limit));
  return new Request(url.toString());
}

function asList(args: ValidatedArgs): { cursor?: string; limit?: number } {
  if (args.kind !== "list") throw new Error("MCP request failed.");
  return args;
}

function asId(args: ValidatedArgs): string {
  if (args.kind !== "id") throw new Error("MCP request failed.");
  return args.id;
}

function asScores(args: ValidatedArgs): { id: string; cursor?: string; limit?: number } {
  if (args.kind !== "scores") throw new Error("MCP request failed.");
  return args;
}

function asPropose(args: ValidatedArgs): { idempotencyKey: string; body: Record<string, unknown> } {
  if (args.kind !== "propose") throw new Error("MCP request failed.");
  return args;
}

async function listShowsTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  const pageArgs = asList(args);
  const page = await listShows(ctx.brandId, pageRequest(pageArgs.cursor, pageArgs.limit));
  const fullIds = await fullShowIdsForCaller(ctx.brandId, page.data);
  return { data: projectShows(page.data, fullIds), next_cursor: page.nextCursor };
}

async function getShowTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  const show = await getShow(ctx.brandId, asId(args));
  const fullIds = await fullShowIdsForCaller(ctx.brandId, [show]);
  const [projected] = projectShows([show], fullIds);
  return { data: projected };
}

async function listCampaignsTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  const pageArgs = asList(args);
  const page = await listCampaigns(ctx.brandId, pageRequest(pageArgs.cursor, pageArgs.limit));
  return { data: page.data, next_cursor: page.nextCursor };
}

async function getCampaignTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  return { data: await getCampaign(ctx.brandId, asId(args)) };
}

async function listScoresTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  const pageArgs = asScores(args);
  const page = await listScores(
    ctx.brandId,
    pageArgs.id,
    pageRequest(pageArgs.cursor, pageArgs.limit)
  );
  return { data: page.data, next_cursor: page.nextCursor };
}

async function getPlanTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  return { data: await getPlan(ctx.brandId, asId(args)) };
}

async function listDealsTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  const pageArgs = asList(args);
  const page = await listDeals(ctx.brandId, pageRequest(pageArgs.cursor, pageArgs.limit));
  return { data: page.data, next_cursor: page.nextCursor };
}

async function getDealTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  return { data: await getDeal(ctx.brandId, asId(args)) };
}

async function listActionsTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  const pageArgs = asList(args);
  const page = await listWriteActions(ctx.brandId, pageRequest(pageArgs.cursor, pageArgs.limit));
  return { data: page.data, next_cursor: page.nextCursor };
}

async function getActionTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  return { data: await getWriteAction(ctx.brandId, asId(args)) };
}

async function proposeCampaignTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  const proposed = asPropose(args);
  const recorded = await recordCampaignCreate({
    brandId: ctx.brandId,
    keyId: ctx.keyId,
    source: ctx.source,
    idempotencyKey: proposed.idempotencyKey,
    body: proposed.body,
  });
  return {
    action_id: recorded.actionId,
    status: recorded.status,
    replayed: recorded.replay,
  };
}

async function proposeOutreachTool(ctx: ToolContext, args: ValidatedArgs): Promise<unknown> {
  const proposed = asPropose(args);
  const recorded = await recordOutreachDraft({
    brandId: ctx.brandId,
    keyId: ctx.keyId,
    source: ctx.source,
    idempotencyKey: proposed.idempotencyKey,
    body: proposed.body,
  });
  return {
    action_id: recorded.actionId,
    status: recorded.status,
    replayed: recorded.replay,
  };
}
