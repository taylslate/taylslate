import { describe, expect, it } from "vitest";
import { openApiDocument } from "./openapi";
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
  CONTACT_FIELDS,
  RATE_FIELDS,
  SCORE_FIELDS,
  SHOW_FIELDS,
} from "./serializers";

interface ObjectSchema {
  properties: Record<string, unknown>;
  additionalProperties?: boolean;
}

describe("api v1 openapi", () => {
  it("matches the serializer allowlists and describes bearer read access", () => {
    const doc = openApiDocument() as {
      openapi: string;
      paths: Record<string, { get: { security: unknown; parameters: unknown[] } }>;
      components: {
        schemas: Record<string, ObjectSchema>;
        securitySchemes: {
          bearerAuth: { type: string; scheme: string; "x-required-scope": string };
        };
      };
    };

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
      "x-required-scope": "read",
    });

    const names = (schema: string) => Object.keys(doc.components.schemas[schema].properties);
    expect(names("Show")).toEqual([...SHOW_FIELDS]);
    expect(names("Campaign")).toEqual([...CAMPAIGN_FIELDS]);
    expect(names("Score")).toEqual([...SCORE_FIELDS]);
    expect(names("Plan")).toEqual([...PLAN_FIELDS]);
    expect(names("PlanLine")).toEqual([...PLAN_LINE_FIELDS]);
    expect(names("Deal")).toEqual([...DEAL_FIELDS]);
    expect(names("Demographics")).toEqual([...DEMOGRAPHIC_FIELDS]);
    expect(names("Rates")).toEqual([...RATE_FIELDS]);
    expect(names("Contact")).toEqual([...CONTACT_FIELDS]);
    expect(names("BriefV1")).toEqual([...BRIEF_V1_FIELDS]);
    expect(names("BriefV2")).toEqual([...BRIEF_V2_FIELDS]);
    expect(names("Product")).toEqual([...PRODUCT_FIELDS]);
    expect(names("Flight")).toEqual([...FLIGHT_FIELDS]);

    expect(doc.components.schemas.Show.properties.demographics).toEqual({
      $ref: "#/components/schemas/Demographics",
    });
    expect(doc.components.schemas.Show.properties.rates).toEqual({
      $ref: "#/components/schemas/Rates",
    });
    expect(doc.components.schemas.Plan.properties.line_items).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/PlanLine" },
    });
    expect(doc.components.schemas.Show.additionalProperties).toBe(false);
    expect(doc.components.schemas.Deal.additionalProperties).toBe(false);

    for (const path of [
      "/api/v1/shows",
      "/api/v1/shows/{id}",
      "/api/v1/campaigns",
      "/api/v1/campaigns/{id}",
      "/api/v1/campaigns/{id}/scores",
      "/api/v1/campaigns/{id}/plan",
      "/api/v1/deals",
      "/api/v1/deals/{id}",
    ]) {
      expect(doc.paths[path].get.security).toEqual([{ bearerAuth: [] }]);
    }

    expect(doc.paths["/api/v1/shows"].get.parameters).toEqual([
      { $ref: "#/components/parameters/limit" },
      { $ref: "#/components/parameters/cursor" },
    ]);
    expect(doc.paths["/api/v1/deals/{id}"].get.parameters).toEqual([
      { $ref: "#/components/parameters/id" },
    ]);
  });
});
