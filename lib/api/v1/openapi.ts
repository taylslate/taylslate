// OpenAPI 3.1 for the public read API. Field lists are the serializer
// allowlists, so the document cannot advertise a column the API omits.

import {
  BRIEF_V1_FIELDS,
  BRIEF_V2_FIELDS,
  CAMPAIGN_FIELDS,
  DEAL_FIELDS,
  DEMOGRAPHIC_FIELDS,
  FLIGHT_FIELDS,
  PLAN_FIELDS,
  PLAN_LINE_FIELDS,
  PRODUCT_FIELDS,
  RATE_FIELDS,
  SCORE_FIELDS,
  SHOW_FIELDS,
} from "@/lib/api/v1/serializers";

type Schema = Record<string, unknown>;

const nullableString: Schema = { type: ["string", "null"] };
const nullableNumber: Schema = { type: ["number", "null"] };
const stringArray: Schema = { type: "array", items: { type: "string" } };

const FIELD_SCHEMAS: Record<string, Schema> = {
  id: { type: "string" },
  name: { type: "string" },
  slug: nullableString,
  platform: nullableString,
  categories: stringArray,
  audience_size: nullableNumber,
  description: nullableString,
  image_url: nullableString,
  network: nullableString,
  tags: stringArray,
  demographics: { $ref: "#/components/schemas/Demographics" },
  audience_interests: stringArray,
  audience_purchase_power: nullableNumber,
  rates: { $ref: "#/components/schemas/Rates" },
  price_type: nullableString,
  min_buy: nullableNumber,
  ad_formats: stringArray,
  episode_cadence: nullableString,
  avg_episode_length_min: nullableNumber,
  current_sponsors: stringArray,
  past_sponsors: stringArray,
  apple_id: nullableString,
  spotify_id: nullableString,
  youtube_channel_id: nullableString,
  rss_url: nullableString,
  available_slots: nullableNumber,
  next_available_date: nullableString,
  contact: { $ref: "#/components/schemas/Contact" },
  verified: { type: "boolean" },
  brand_url: nullableString,
  target_age_range: nullableString,
  target_gender: nullableString,
  target_interests: stringArray,
  keywords: stringArray,
  campaign_goals: nullableString,
  version: { type: "integer", const: 2 },
  product: {
    oneOf: [{ $ref: "#/components/schemas/Product" }, { type: "null" }],
  },
  customer_text: nullableString,
  goals: stringArray,
  goals_context: nullableString,
  flight: {
    oneOf: [{ $ref: "#/components/schemas/Flight" }, { type: "null" }],
  },
  exclusions_text: nullableString,
  submitted_at: nullableString,
  brand_name: nullableString,
  category: nullableString,
  product_description: nullableString,
  aov_bucket: nullableString,
  aov_reasoning: nullableString,
  key_attributes: stringArray,
  source: nullableString,
  url: nullableString,
  mode: nullableString,
  preset: nullableString,
  start_date: nullableString,
  end_date: nullableString,
  status: nullableString,
  budget_total: nullableNumber,
  platforms: stringArray,
  brief: {
    oneOf: [
      { $ref: "#/components/schemas/BriefV1" },
      { $ref: "#/components/schemas/BriefV2" },
    ],
  },
  test_spot_count: nullableNumber,
  test_placement: nullableString,
  created_at: nullableString,
  updated_at: nullableString,
  show_id: nullableString,
  ring_hypothesis_id: nullableString,
  audience_fit_score: nullableNumber,
  topical_relevance_score: nullableNumber,
  purchase_power_score: nullableNumber,
  composite_score: nullableNumber,
  conviction_band: nullableString,
  reasoning: nullableString,
  tier: nullableString,
  default_placement: nullableString,
  default_episodes: nullableNumber,
  spacing: nullableString,
  line_items: {
    type: "array",
    items: { $ref: "#/components/schemas/PlanLine" },
  },
  podcast_id: nullableString,
  placement: nullableString,
  num_episodes: nullableNumber,
  addon_surface_ids: stringArray,
  campaign_id: nullableString,
  ad_format: nullableString,
  flight_start: nullableString,
  flight_end: nullableString,
  cpm_rate: nullableNumber,
  gross_cpm: nullableNumber,
  gross_per_episode: nullableNumber,
  total_gross: nullableNumber,
  agreed_cpm: nullableNumber,
  guaranteed_downloads: nullableNumber,
};

function fieldSchema(name: string): Schema {
  const schema = FIELD_SCHEMAS[name];
  if (!schema) throw new Error(`Missing OpenAPI schema for ${name}.`);
  return schema;
}

function objectSchema(fields: readonly string[]): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const field of fields) {
    properties[field] = fieldSchema(field);
    required.push(field);
  }
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function numberObject(fields: readonly string[]): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const field of fields) {
    properties[field] = nullableNumber;
    required.push(field);
  }
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function pageSchema(itemName: string): Schema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["data", "next_cursor"],
    properties: {
      data: {
        type: "array",
        items: { $ref: `#/components/schemas/${itemName}` },
      },
      next_cursor: { type: ["string", "null"] },
    },
  };
}

function itemSchema(itemName: string, nullable = false): Schema {
  const item: Schema = nullable
    ? { oneOf: [{ $ref: `#/components/schemas/${itemName}` }, { type: "null" }] }
    : { $ref: `#/components/schemas/${itemName}` };
  return {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: { data: item },
  };
}

function errorResponse(description: string, extra?: Schema): Schema {
  const response: Schema = {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
      },
    },
  };
  if (extra) response.headers = extra;
  return response;
}

function actionReceipt(): Schema {
  return {
    description: "The recorded action. A replay returns the original row.",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ActionReceipt" },
      },
    },
  };
}

function writeOperation(options: {
  operationId: string;
  summary: string;
  scope: "write:campaigns" | "write:outreach";
  bodyRef: string;
  notFound: boolean;
}): Schema {
  const responses: Record<string, Schema> = {
    "200": actionReceipt(),
    "202": actionReceipt(),
    "400": errorResponse("Idempotency-Key is missing or not 1 to 128 printable characters."),
    "401": errorResponse("Missing or invalid API key."),
    "403": errorResponse(`API key lacks the ${options.scope} scope.`),
    "409": errorResponse("Idempotency key was already used with a different payload."),
    "413": errorResponse("Request body is too large."),
    "415": errorResponse("Request body must be JSON."),
    "422": errorResponse("The body failed validation."),
    "429": errorResponse("Rate limit exceeded.", {
      "Retry-After": {
        description: "Seconds until the current window resets.",
        schema: { type: "integer" },
      },
    }),
    "500": errorResponse("API request failed."),
  };
  if (options.notFound) {
    responses["404"] = errorResponse("Not found.");
  }
  return {
    operationId: options.operationId,
    summary: options.summary,
    security: [{ bearerAuth: [] }],
    "x-required-scope": options.scope,
    parameters: [{ $ref: "#/components/parameters/idempotencyKey" }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${options.bodyRef}` },
        },
      },
    },
    responses,
  };
}

function readOperation(options: {
  operationId: string;
  summary: string;
  responseRef: string;
  paginated?: boolean;
  idParam?: boolean;
}): Schema {
  const parameters: Schema[] = [];
  if (options.idParam) {
    parameters.push({ $ref: "#/components/parameters/id" });
  }
  if (options.paginated) {
    parameters.push({ $ref: "#/components/parameters/limit" });
    parameters.push({ $ref: "#/components/parameters/cursor" });
  }
  return {
    operationId: options.operationId,
    summary: options.summary,
    security: [{ bearerAuth: [] }],
    parameters,
    responses: {
      "200": {
        description: options.summary,
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${options.responseRef}` },
          },
        },
      },
      "400": errorResponse("Invalid limit or cursor."),
      "401": errorResponse("Missing or invalid API key."),
      "403": errorResponse("API key lacks the read scope."),
      "404": errorResponse("Not found."),
      "429": errorResponse("Rate limit exceeded.", {
        "Retry-After": {
          description: "Seconds until the current window resets.",
          schema: { type: "integer" },
        },
      }),
      "500": errorResponse("API request failed."),
    },
  };
}

export function openApiDocument(): Schema {
  return {
    openapi: "3.1.0",
    info: {
      title: "Taylslate API",
      version: "1.0.0",
      description:
        "Brand-scoped read API. Send Authorization: Bearer with an API key that includes the read scope. GET /api/v1/openapi.json does not require a key. Lists are ordered by created_at descending, then id descending. Page size defaults to 25 and clamps at 100. Write calls require write:campaigns or write:outreach, an Idempotency-Key of 1 to 128 printable characters, and a JSON body of at most 64 KB. A write is recorded as a pending action and is not executed.",
    },
    servers: [{ url: "https://www.taylslate.com" }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/v1/shows": {
        get: readOperation({
          operationId: "listShows",
          summary: "List visible shows.",
          responseRef: "ShowPage",
          paginated: true,
        }),
      },
      "/api/v1/shows/{id}": {
        get: readOperation({
          operationId: "getShow",
          summary: "Read one visible show.",
          responseRef: "ShowItem",
          idParam: true,
        }),
      },
      "/api/v1/campaigns": {
        get: readOperation({
          operationId: "listCampaigns",
          summary: "List campaigns for this brand.",
          responseRef: "CampaignPage",
          paginated: true,
        }),
        post: writeOperation({
          operationId: "createCampaignAction",
          summary: "Record a campaign create. Nothing is executed.",
          scope: "write:campaigns",
          bodyRef: "CampaignCreate",
          notFound: true,
        }),
      },
      "/api/v1/campaigns/{id}": {
        get: readOperation({
          operationId: "getCampaign",
          summary: "Read one campaign for this brand.",
          responseRef: "CampaignItem",
          idParam: true,
        }),
      },
      "/api/v1/campaigns/{id}/scores": {
        get: readOperation({
          operationId: "listCampaignScores",
          summary: "List conviction scores for one campaign.",
          responseRef: "ScorePage",
          paginated: true,
          idParam: true,
        }),
      },
      "/api/v1/campaigns/{id}/plan": {
        get: readOperation({
          operationId: "getCampaignPlan",
          summary: "Read the media plan for one campaign.",
          responseRef: "PlanItem",
          idParam: true,
        }),
      },
      "/api/v1/deals": {
        get: readOperation({
          operationId: "listDeals",
          summary: "List deals for this brand.",
          responseRef: "DealPage",
          paginated: true,
        }),
      },
      "/api/v1/deals/{id}": {
        get: readOperation({
          operationId: "getDeal",
          summary: "Read one deal for this brand.",
          responseRef: "DealItem",
          idParam: true,
        }),
      },
      "/api/v1/outreach": {
        post: writeOperation({
          operationId: "createOutreachDraft",
          summary: "Record an outreach draft. Nothing is sent.",
          scope: "write:outreach",
          bodyRef: "OutreachDraft",
          notFound: true,
        }),
      },
      "/api/v1/actions": {
        get: readOperation({
          operationId: "listActions",
          summary: "List recorded write actions for this brand.",
          responseRef: "ActionPage",
          paginated: true,
        }),
      },
      "/api/v1/actions/{id}": {
        get: readOperation({
          operationId: "getAction",
          summary: "Read one recorded write action for this brand.",
          responseRef: "ActionItem",
          idParam: true,
        }),
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API key",
          description:
            "Bearer token ts_live_<prefix>_<secret>. The key must include the read scope.",
          "x-required-scope": "read",
        },
      },
      parameters: {
        limit: {
          name: "limit",
          in: "query",
          required: false,
          description: "Page size. Default 25. Values above 100 clamp to 100.",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        },
        cursor: {
          name: "cursor",
          in: "query",
          required: false,
          description: "Opaque next_cursor from the previous page.",
          schema: { type: "string" },
        },
        id: {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        idempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          description:
            "1 to 128 printable ASCII characters. The same key and payload return the original action.",
          schema: { type: "string", minLength: 1, maxLength: 128 },
        },
      },
      schemas: {
        Error: {
          type: "object",
          additionalProperties: false,
          required: ["error"],
          properties: { error: { type: "string" } },
        },
        Demographics: numberObject(DEMOGRAPHIC_FIELDS),
        Rates: numberObject(RATE_FIELDS),
        Contact: {
          type: "object",
          additionalProperties: false,
          required: ["name", "email", "method"],
          properties: {
            name: nullableString,
            email: nullableString,
            method: nullableString,
          },
        },
        Product: objectSchema(PRODUCT_FIELDS),
        Flight: objectSchema(FLIGHT_FIELDS),
        BriefV1: objectSchema(BRIEF_V1_FIELDS),
        BriefV2: objectSchema(BRIEF_V2_FIELDS),
        Show: objectSchema(SHOW_FIELDS),
        Campaign: objectSchema(CAMPAIGN_FIELDS),
        Score: objectSchema(SCORE_FIELDS),
        PlanLine: objectSchema(PLAN_LINE_FIELDS),
        Plan: objectSchema(PLAN_FIELDS),
        Deal: objectSchema(DEAL_FIELDS),
        ShowPage: pageSchema("Show"),
        ShowItem: itemSchema("Show"),
        CampaignPage: pageSchema("Campaign"),
        CampaignItem: itemSchema("Campaign"),
        ScorePage: pageSchema("Score"),
        ScoreItem: itemSchema("Score"),
        PlanItem: itemSchema("Plan", true),
        DealPage: pageSchema("Deal"),
        DealItem: itemSchema("Deal"),
        CampaignCreate: {
          type: "object",
          additionalProperties: false,
          required: ["goals", "budget_total", "flight"],
          description:
            "Fields the manual brief accepts. A fresh brief requires product and customer_text. A reuse sends customer_context.reused_from_pattern_id instead.",
          properties: {
            product: { $ref: "#/components/schemas/CampaignProduct" },
            customer_text: { type: "string" },
            customer_context: { $ref: "#/components/schemas/CustomerContext" },
            goals: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: {
                type: "string",
                enum: [
                  "test_channel",
                  "scale_winner",
                  "direct_response",
                  "brand_awareness",
                  "lead_gen",
                ],
              },
            },
            goals_context: { type: "string" },
            budget_total: { type: "number", minimum: 5000 },
            flight: { $ref: "#/components/schemas/CampaignFlight" },
            exclusions_text: { type: "string" },
          },
        },
        CampaignProduct: {
          type: "object",
          additionalProperties: false,
          required: [
            "brand_name",
            "category",
            "product_description",
            "aov_bucket",
            "aov_reasoning",
            "key_attributes",
            "source",
            "url",
          ],
          properties: {
            brand_name: { type: "string" },
            category: { type: "string" },
            product_description: { type: "string" },
            aov_bucket: { type: "string", enum: ["low", "mid", "high"] },
            aov_reasoning: { type: "string" },
            key_attributes: stringArray,
            source: { type: "string", enum: ["url", "paragraph"] },
            url: nullableString,
          },
        },
        CampaignFlight: {
          type: "object",
          additionalProperties: false,
          required: ["mode"],
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
        CustomerContext: {
          type: "object",
          additionalProperties: false,
          required: ["reused_from_pattern_id"],
          properties: {
            reused_from_pattern_id: { type: "string", format: "uuid" },
            delta_text: { type: "string" },
            product_url: nullableString,
            changed_fields: { type: "object" },
            product_attributes: { type: "object" },
          },
        },
        OutreachDraft: {
          type: "object",
          additionalProperties: false,
          required: ["show_id", "subject", "body"],
          properties: {
            show_id: { type: "string", format: "uuid" },
            subject: { type: "string", minLength: 1, maxLength: 200 },
            body: { type: "string", minLength: 30, maxLength: 5000 },
          },
        },
        ActionReceipt: {
          type: "object",
          additionalProperties: false,
          required: ["action_id", "status"],
          properties: {
            action_id: { type: "string", format: "uuid" },
            status: {
              type: "string",
              enum: ["pending", "approved", "rejected", "expired"],
            },
          },
        },
        Action: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "kind",
            "status",
            "idempotency_key",
            "payload",
            "created_at",
            "decided_at",
            "decided_by",
          ],
          properties: {
            id: { type: "string", format: "uuid" },
            kind: { type: "string", enum: ["campaign.create", "outreach.draft"] },
            status: {
              type: "string",
              enum: ["pending", "approved", "rejected", "expired"],
            },
            idempotency_key: { type: "string" },
            payload: { type: "object" },
            created_at: { type: "string" },
            decided_at: nullableString,
            decided_by: nullableString,
          },
        },
        ActionPage: pageSchema("Action"),
        ActionItem: itemSchema("Action"),
      },
    },
  };
}
