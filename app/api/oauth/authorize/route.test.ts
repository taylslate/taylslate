import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OauthTestAdmin } from "@/lib/mcp-oauth/test-store";
import { SECRET_DB } from "@/lib/mcp-oauth/test-store";

const bridge = vi.hoisted(() => ({ admin: null as OauthTestAdmin | null }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => bridge.admin!.from(table),
    rpc: (name: string, args: Record<string, unknown>) => bridge.admin!.rpc(name, args),
  },
}));

import { GET } from "./route";
import { TEST_REDIRECT, createOauthTestAdmin, installOauthEnv, pkcePair } from "@/lib/mcp-oauth/test-store";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;
const CLIENT_ID = `tsc_${"ab".repeat(16)}`;

beforeEach(() => {
  bridge.admin = createOauthTestAdmin();
  installOauthEnv();
  bridge.admin.tables.mcp_oauth_clients.push({
    id: "33333333-3333-4333-8333-333333333333",
    client_id: CLIENT_ID,
    client_name: "Cursor",
    redirect_uris: [TEST_REDIRECT],
  });
});

afterEach(() => {
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

function authorize(extra: Record<string, string> = {}): Promise<Response> {
  const { challenge } = pkcePair();
  const url = new URL("https://www.taylslate.com/api/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", TEST_REDIRECT);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", "ok");
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return GET(new Request(url));
}

describe("GET /api/oauth/authorize", () => {
  it("returns 400 with no Location for a bad client", async () => {
    const response = await authorize({ client_id: "not-a-client" });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
    expect(JSON.stringify(body)).not.toContain(SECRET_DB);
  });

  it("redirects an unknown scope and a wrong resource", async () => {
    const scope = await authorize({ scope: "read nope" });
    expect(scope.status).toBe(302);
    expect(new URL(scope.headers.get("location") ?? "").searchParams.get("error")).toBe("invalid_scope");
    const target = await authorize({ resource: "https://evil.example/mcp" });
    expect(new URL(target.headers.get("location") ?? "").searchParams.get("error")).toBe("invalid_target");
    expect(target.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 429 when the rule is hit and 503 when the store or the table fails", async () => {
    bridge.admin!.denyBuckets.add("mcp_oauth_authorize_ip_hour");
    const limited = await authorize();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Too many requests. Try again later." });

    bridge.admin = createOauthTestAdmin();
    installOauthEnv();
    bridge.admin.rateError = { code: "XX000", message: SECRET_DB };
    const closed = await authorize();
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: "unavailable" });
    expect(closed.headers.get("location")).toBeNull();

    bridge.admin = createOauthTestAdmin();
    installOauthEnv();
    bridge.admin.missingTables.add("mcp_oauth_clients");
    const missing = await authorize();
    expect(missing.status).toBe(503);
    const body = await missing.json();
    expect(body.error).toBe("temporarily_unavailable");
    expect(JSON.stringify(body)).not.toContain(SECRET_DB);
  });
});
