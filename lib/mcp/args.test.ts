import { describe, expect, it } from "vitest";
import { ApiReadError, ApiWriteError } from "@/lib/api/v1/handler";
import { validateToolArguments } from "@/lib/mcp/args";

const SHOW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function campaign(extra: Record<string, unknown> = {}) {
  return {
    idempotency_key: "campaign-key",
    product: {
      brand_name: "Sauna Box",
      category: "Home",
      product_description: "A home sauna kit.",
      aov_bucket: "high",
      aov_reasoning: "Kits sell above two hundred dollars.",
      key_attributes: ["home"],
      source: "url",
      url: "https://saunabox.example",
    },
    customer_text: "People who want a sauna at home.",
    goals: ["test_channel"],
    budget_total: 25000,
    flight: { mode: "preset", preset: "next_30_days" },
    ...extra,
  };
}

describe("validateToolArguments", () => {
  it("rejects brand, user, and key ids as unknown fields", () => {
    for (const key of ["brand_id", "brandId", "user_id", "userId", "key_id", "keyId", "api_key_id"]) {
      expect(() => validateToolArguments("list_shows", { [key]: "11111111-1111-4111-8111-111111111111" })).toThrow(
        ApiWriteError
      );
      try {
        validateToolArguments("list_shows", { [key]: "nope" });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiWriteError);
        expect((err as ApiWriteError).status).toBe(422);
        expect((err as ApiWriteError).message).toBe(`Unknown field ${key}.`);
      }
    }
  });

  it("checks limit, cursor, and uuid before a handler runs", () => {
    expect(validateToolArguments("list_campaigns", { limit: 500 })).toEqual({
      kind: "list",
      limit: 500,
    });
    expect(() => validateToolArguments("list_campaigns", { limit: 0 })).toThrow(ApiReadError);
    expect(() => validateToolArguments("list_campaigns", { limit: 1.5 })).toThrow(ApiReadError);
    expect(() => validateToolArguments("list_campaigns", { limit: "25" })).toThrow(ApiReadError);
    expect(() => validateToolArguments("list_campaigns", { cursor: 12 })).toThrow(ApiReadError);
    expect(() => validateToolArguments("get_show", { id: "not-a-uuid" })).toThrow(ApiReadError);
    try {
      validateToolArguments("get_deal", {});
    } catch (err) {
      expect(err).toBeInstanceOf(ApiReadError);
      expect((err as ApiReadError).status).toBe(404);
      expect((err as ApiReadError).message).toBe("Not found.");
    }
  });

  it("requires a printable idempotency key and rejects a nested unknown field", () => {
    const parsed = validateToolArguments("propose_campaign", campaign());
    expect(parsed).toMatchObject({ kind: "propose", idempotencyKey: "campaign-key" });
    if (parsed.kind === "propose") {
      expect(parsed.body).not.toHaveProperty("idempotency_key");
    }

    expect(() => validateToolArguments("propose_campaign", campaign({ idempotency_key: "" }))).toThrow(
      ApiWriteError
    );
    expect(() =>
      validateToolArguments("propose_campaign", campaign({ idempotency_key: "x".repeat(129) }))
    ).toThrow(ApiWriteError);
    expect(() => validateToolArguments("propose_campaign", campaign({ idempotency_key: "has space" }))).toThrow(
      ApiWriteError
    );

    expect(() =>
      validateToolArguments(
        "propose_campaign",
        campaign({
          product: {
            ...(campaign().product as object),
            stripe_price: "price_secret",
          },
        })
      )
    ).toThrow(/Unknown field stripe_price/);

    expect(() =>
      validateToolArguments("propose_outreach", {
        idempotency_key: "draft-1",
        show_id: SHOW,
        subject: "Hello",
        body: "short",
      })
    ).toThrow(/body is too short/);
  });
});
