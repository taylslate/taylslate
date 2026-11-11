import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bridge = vi.hoisted(() => ({
  profile: {
    data: null as Record<string, unknown> | null,
    error: null as { code?: string; message?: string } | null,
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        or() {
          return builder;
        },
        in() {
          return builder;
        },
        maybeSingle: async () => (table === "profiles" ? bridge.profile : { data: null, error: null }),
        then(onFulfilled: (value: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve(onFulfilled({ data: [], error: null }));
        },
      };
      return builder;
    },
  },
}));

vi.mock("@/lib/api/plan-gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/plan-gate")>("@/lib/api/plan-gate");
  return {
    ...actual,
    assertBrandApiAccess: vi.fn((brandId: string) => actual.assertBrandApiAccess(brandId)),
  };
});

import { PLANS, type PlanId } from "@/lib/billing/plans";
import { brandHasApiAccess } from "@/lib/api/key-settings";
import { ApiAuthError } from "@/lib/api/auth";
import { assertBrandApiAccess } from "@/lib/api/plan-gate";
import { dispatchAgentTool } from "@/lib/command-agent/tools";
import * as mcpTools from "@/lib/mcp/tools";

const BRAND = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function profile(role: string, plan: unknown) {
  bridge.profile = { data: { role, plan }, error: null };
}

async function expectDenied() {
  const err = await assertBrandApiAccess(BRAND).catch((error: unknown) => error);
  expect(err).toBeInstanceOf(ApiAuthError);
  expect(err).toMatchObject({
    status: 403,
    code: "plan_no_api_access",
    message: "Your plan does not include API access.",
  });
}

beforeEach(() => {
  bridge.profile = { data: null, error: null };
  vi.mocked(assertBrandApiAccess).mockClear();
});

describe("assertBrandApiAccess", () => {
  it("allows operator and agency brands", async () => {
    profile("brand", "operator");
    await expect(assertBrandApiAccess(BRAND)).resolves.toBeUndefined();
    profile("brand", "agency");
    await expect(assertBrandApiAccess(BRAND)).resolves.toBeUndefined();
  });

  it("denies pay as you go, starter, an unknown plan, and a missing row", async () => {
    profile("brand", "pay_as_you_go");
    await expectDenied();
    profile("brand", "starter");
    await expectDenied();
    profile("brand", "not-a-plan");
    await expectDenied();
    bridge.profile = { data: null, error: null };
    await expectDenied();
  });

  it("denies agent and admin even when the plan has API access", async () => {
    profile("agent", "operator");
    await expectDenied();
    profile("admin", "agency");
    await expectDenied();
  });

  it("agrees with brandHasApiAccess for every PlanId and an unknown plan", async () => {
    const plans: unknown[] = [...(Object.keys(PLANS) as PlanId[]), "not-a-plan"];
    for (const plan of plans) {
      profile("brand", plan);
      if (brandHasApiAccess(plan)) {
        await expect(assertBrandApiAccess(BRAND)).resolves.toBeUndefined();
      } else {
        await expectDenied();
      }
    }
  });

  it("rejects a profiles read error with a plain Error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bridge.profile = {
      data: null,
      error: { code: "57014", message: "brand@example.com secret-key" },
    };
    const err = await assertBrandApiAccess(BRAND).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ApiAuthError);
    expect((err as Error).message).toBe("API key lookup failed.");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("brand@example.com");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-key");
    warn.mockRestore();
  });
});

describe("Tay", () => {
  it("calls a tool for a pay as you go brand without the plan gate", async () => {
    profile("brand", "pay_as_you_go");
    vi.mocked(assertBrandApiAccess).mockClear();
    const call = vi.spyOn(mcpTools, "callTool");
    const result = await dispatchAgentTool({
      brandId: BRAND,
      name: "list_campaigns",
      args: {},
      userMessageId: MESSAGE,
      proposeOrdinal: 0,
    });
    expect(result.isError).toBe(false);
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: BRAND, keyId: null, source: "command_agent" }),
      "list_campaigns",
      {}
    );
    expect(assertBrandApiAccess).not.toHaveBeenCalled();
    call.mockRestore();
  });

  it("does not import API auth or the plan gate from Tay or the tool registry", () => {
    const sources = [
      ...readdirSync(join(ROOT, "lib/command-agent"))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => readFileSync(join(ROOT, "lib/command-agent", name), "utf8")),
      readFileSync(join(ROOT, "lib/mcp/tools.ts"), "utf8"),
    ];
    const imports = sources
      .flatMap((source) => source.split("\n"))
      .filter((line) => line.includes("import"))
      .join("\n");
    expect(imports).not.toMatch(/lib\/api\/auth/);
    expect(imports).not.toMatch(/lib\/api\/plan-gate/);
  });
});
