import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

describe("supabase modules import without env", () => {
  const previous = new Map<string, string | undefined>();

  afterEach(() => {
    vi.resetModules();
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  });

  function withoutSupabaseEnv() {
    for (const key of ENV_KEYS) {
      if (!previous.has(key)) previous.set(key, process.env[key]);
      delete process.env[key];
    }
    vi.resetModules();
  }

  it("imports the admin client, factories, and /api/auth/magic without creating a client", async () => {
    withoutSupabaseEnv();

    const admin = await import("./admin");
    const server = await import("./server");
    const browser = await import("./client");
    const magic = await import("../../app/api/auth/magic/route");
    const magicStart = await import("../../app/api/auth/magic/start/route");

    expect(admin.supabaseAdmin).toBeDefined();
    expect(typeof server.createClient).toBe("function");
    expect(typeof browser.createClient).toBe("function");
    expect(typeof magic.GET).toBe("function");
    expect(typeof magicStart.POST).toBe("function");

    expect(() => {
      void admin.supabaseAdmin.from;
    }).toThrow(/supabaseUrl is required/);
    expect(() => browser.createClient()).toThrow(/URL and API key are required/);
  });

  it("throws supabaseKey is required when the url is set and the service role key is not", async () => {
    withoutSupabaseEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

    const admin = await import("./admin");
    expect(() => {
      void admin.supabaseAdmin.auth;
    }).toThrow(/supabaseKey is required/);
  });

  it("builds one service-role client from env on first use", async () => {
    withoutSupabaseEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";

    const admin = await import("./admin");
    const builder = admin.supabaseAdmin.from("profiles");
    expect(typeof builder.select).toBe("function");
    expect(admin.supabaseAdmin.auth).toBe(admin.supabaseAdmin.auth);
    expect(typeof admin.supabaseAdmin.auth.admin.generateLink).toBe("function");
    expect(typeof admin.supabaseAdmin.rpc).toBe("function");
  });
});
