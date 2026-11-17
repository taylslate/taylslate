import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://www.taylslate.com";

const harness = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
  updatePayload: null as Record<string, unknown> | null,
  eqColumn: "",
  eqId: "",
  select: "",
  dbError: null as { code: string; message: string } | null,
  limitMode: "allow" as "allow" | "deny" | "down",
  limitCalls: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: harness.user } }),
    },
    from: (table: string) => {
      if (table !== "profiles") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        update: (payload: Record<string, unknown>) => {
          harness.updatePayload = payload;
          return {
            eq: (column: string, id: string) => {
              harness.eqColumn = column;
              harness.eqId = id;
              return {
                select: (columns: string) => {
                  harness.select = columns;
                  return {
                    single: async () => {
                      if (harness.dbError) return { data: null, error: harness.dbError };
                      return {
                        data: { company_name: payload.company_name },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  }),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRules: async (input: unknown) => {
    harness.limitCalls.push(input);
    if (harness.limitMode === "deny") {
      return new Response(
        JSON.stringify({ error: "Too many requests. Try again later." }),
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }
    if (harness.limitMode === "down") {
      return new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
    }
    return null;
  },
}));

import { PATCH } from "./route";

function patch(
  body: unknown,
  origin: string | null = ORIGIN,
  url = `${ORIGIN}/api/settings/profile`
) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  if (raw) headers.set("content-type", "application/json");
  return PATCH(
    new NextRequest(url, {
      method: "PATCH",
      headers,
      body: raw,
    })
  );
}

beforeEach(() => {
  harness.user = { id: USER_ID, email: "secret-user@example.com" };
  harness.updatePayload = null;
  harness.eqColumn = "";
  harness.eqId = "";
  harness.select = "";
  harness.dbError = null;
  harness.limitMode = "allow";
  harness.limitCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PATCH /api/settings/profile", () => {
  it("returns 401 without a session", async () => {
    harness.user = null;
    const res = await patch({ company_name: "Northwind" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(harness.updatePayload).toBeNull();
    expect(harness.limitCalls).toHaveLength(0);
  });

  it("returns 403 with no Origin and with a foreign Origin", async () => {
    const missing = await patch({ company_name: "Northwind" }, null);
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({ error: "Forbidden" });

    const foreign = await patch({ company_name: "Northwind" }, "https://evil.example");
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "Forbidden" });
    expect(harness.updatePayload).toBeNull();
  });

  it("returns 429 when the limiter denies and 503 when it is unavailable", async () => {
    harness.limitMode = "deny";
    const limited = await patch({ company_name: "Northwind" });
    expect(limited.status).toBe(429);
    expect(harness.updatePayload).toBeNull();

    harness.limitMode = "down";
    const down = await patch({ company_name: "Northwind" });
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: "unavailable" });
    expect(harness.updatePayload).toBeNull();
    expect(harness.limitCalls[0]).toEqual({
      failureMode: "closed",
      rules: [
        {
          bucket: "settings_profile_user_hour",
          key: USER_ID,
          max: 30,
          windowSeconds: 3600,
        },
      ],
    });
    expect(JSON.stringify(harness.limitCalls)).not.toContain("secret-user@example.com");
  });

  it("returns 400 for bad JSON, an extra key, a non-string, and 121 characters", async () => {
    const badJson = await patch("{");
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: "Invalid request" });

    const extraRole = await patch({ company_name: "Northwind", role: "admin" });
    expect(extraRole.status).toBe(400);
    expect(await extraRole.json()).toEqual({ error: "Invalid request" });

    const extraPlan = await patch({ company_name: "Northwind", plan: "operator" });
    expect(extraPlan.status).toBe(400);
    expect(await extraPlan.json()).toEqual({ error: "Invalid request" });

    const numberValue = await patch({ company_name: 12 });
    expect(numberValue.status).toBe(400);
    expect(await numberValue.json()).toEqual({ error: "Invalid request" });

    const tooLong = await patch({ company_name: "a".repeat(121) });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({
      error: "Company name must be 120 characters or fewer.",
    });

    const oversized = await patch({ company_name: "a".repeat(5000) });
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "Invalid request" });

    expect(harness.updatePayload).toBeNull();
  });

  it("trims, collapses whitespace, and stores null for blank", async () => {
    const blank = await patch({ company_name: "  \n\t  " });
    expect(blank.status).toBe(200);
    expect(blank.headers.get("cache-control")).toBe("no-store");
    expect(await blank.json()).toEqual({ company_name: null });
    expect(harness.updatePayload).toEqual({ company_name: null });
    expect(harness.eqColumn).toBe("id");
    expect(harness.eqId).toBe(USER_ID);
    expect(harness.select).toBe("company_name");

    harness.updatePayload = null;
    const named = await patch({ company_name: "  Northwind   Goods \n " });
    expect(named.status).toBe(200);
    expect(await named.json()).toEqual({ company_name: "Northwind Goods" });
    expect(harness.updatePayload).toEqual({ company_name: "Northwind Goods" });
    expect(Object.keys(harness.updatePayload ?? {})).toEqual(["company_name"]);
    expect(harness.eqColumn).toBe("id");
    expect(harness.eqId).toBe(USER_ID);

    const exact = await patch({ company_name: "b".repeat(120) });
    expect(exact.status).toBe(200);
    expect(await exact.json()).toEqual({ company_name: "b".repeat(120) });

    const control = await patch({ company_name: "Acme\u0007Co" });
    expect(control.status).toBe(200);
    expect(await control.json()).toEqual({ company_name: "AcmeCo" });
  });

  it("returns the fixed 500 text and hides the database error", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(" "));
    });
    harness.dbError = {
      code: "XX000",
      message: `secret-db-text company_name profiles ${USER_ID}`,
    };
    const res = await patch({ company_name: "Northwind" });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Could not save. Try again." });
    expect(text).not.toContain("secret-db-text");
    expect(text).not.toContain("company_name");
    expect(text).not.toContain(USER_ID);
    expect(logs.join("\n")).toContain("XX000");
    expect(logs.join("\n")).not.toContain("secret-db-text");
    expect(logs.join("\n")).not.toContain(USER_ID);
  });
});
